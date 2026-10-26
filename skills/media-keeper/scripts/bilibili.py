#!/usr/bin/env python3
"""Anonymous Bilibili audio retrieval and local transcription; no database writes."""
import argparse
from collections import Counter
import http.client
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

HEADERS = {"User-Agent": "Mozilla/5.0", "Referer": "https://www.bilibili.com/"}
API = "https://api.bilibili.com/x/player/"
JOB_PREFIX = "media-keeper-bilibili-"
MARKER = ".media-keeper-bilibili-job"


class AudioError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def request(url):
    address = urllib.parse.urlsplit(url)
    if address.scheme != "https" or address.username or address.password:
        raise AudioError("invalid_media_url", "音频接口必须返回无账号信息的 HTTPS 地址")
    return urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=35)


def get_json(url):
    for attempt in range(2):
        try:
            with request(url) as response:
                value = json.loads(response.read(8 * 1024 * 1024))
            if value.get("code") != 0:
                raise AudioError("bilibili_api_error", "Bilibili 接口拒绝匿名访问，code=" + str(value.get("code")))
            return value["data"]
        except (urllib.error.URLError, TimeoutError):
            if attempt:
                raise
            time.sleep(2)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def resolve_short_url(url):
    """Read only Location; following to the HTML page can itself receive HTTP 412."""
    opener = urllib.request.build_opener(NoRedirect)
    for _ in range(5):
        address = urllib.parse.urlsplit(url)
        if address.hostname not in {"b23.tv", "www.b23.tv", "bili2233.cn"}:
            return url
        try:
            with opener.open(urllib.request.Request(url, headers=HEADERS), timeout=35):
                break
        except urllib.error.HTTPError as error:
            location = error.headers.get("Location")
            if error.code not in {301, 302, 303, 307, 308} or not location:
                raise
            url = urllib.parse.urljoin(url, location)
            if urllib.parse.urlsplit(url).scheme != "https":
                raise AudioError("invalid_url", "短链接跳转目标必须使用 HTTPS")
    raise AudioError("invalid_url", "无法解析 Bilibili 短链接，请提供 /video/BV… 原链接")


def parse_video(value):
    value = value.strip()
    part = None
    if not re.fullmatch(r"BV[0-9A-Za-z]{10}|av[1-9][0-9]*", value):
        value = resolve_short_url(value)
        address = urllib.parse.urlsplit(value)
        host = address.hostname or ""
        if address.scheme != "https" or address.username or address.password or not (host == "bilibili.com" or host.endswith(".bilibili.com")):
            raise AudioError("invalid_url", "请提供 Bilibili 视频链接、BV 号或 av 号")
        match = re.search(r"/video/(BV[0-9A-Za-z]{10}|av[1-9][0-9]*)(?:/|$)", address.path)
        if not match:
            raise AudioError("unsupported_video", "暂只处理 Bilibili 投稿视频，不处理直播、番剧或收藏夹")
        value = match.group(1)
        pages = urllib.parse.parse_qs(address.query).get("p")
        if pages:
            if len(pages) != 1 or not re.fullmatch(r"[1-9][0-9]*", pages[0]):
                raise AudioError("invalid_part", "视频分 P 参数必须是正整数")
            part = int(pages[0])
    key, identifier = ("bvid", value) if value.startswith("BV") else ("aid", value[2:])
    link = "https://www.bilibili.com/video/" + value + "/"
    if part is not None:
        link += "?p=" + str(part)
    return value, {key: identifier}, part, link


def play_url(query, cid):
    return API + "playurl?" + urllib.parse.urlencode({**query, "cid": cid, "fnval": 4048, "qn": 16, "fourk": 0})


def download_audio(query, page, destination):
    partial = destination.with_suffix(".part")
    try:
        for refresh in range(2):
            play = get_json(play_url(query, page["cid"]))
            if play.get("is_preview") or play.get("isPreview"):
                raise AudioError("preview_only", "接口只提供试看音频，不能用于完整内容摘要")
            expected = float(page["duration"])
            if play.get("timelength") and float(play["timelength"]) / 1000 < expected - max(3, expected * .01):
                raise AudioError("preview_only", "可播放时长短于原视频，不能用于完整内容摘要")
            tracks = (play.get("dash") or {}).get("audio") or []
            tracks = [track for track in tracks if track.get("baseUrl") or track.get("base_url")]
            if not tracks:
                raise AudioError("no_public_audio", "未返回独立匿名音轨，不使用简介或网页片段代替")
            track = min(tracks, key=lambda x: float(x.get("bandwidth") or math.inf))
            addresses = [track.get("baseUrl") or track.get("base_url")]
            addresses += track.get("backupUrl") or track.get("backup_url") or []
            for address in dict.fromkeys(addresses):
                try:
                    with request(address) as response, partial.open("wb") as output:
                        os.chmod(partial, 0o600)
                        declared = response.headers.get("Content-Length")
                        count = 0
                        while True:
                            block = response.read(1024 * 1024)
                            if not block:
                                break
                            count += len(block)
                            if count > 512 * 1024 * 1024:
                                raise AudioError("audio_too_large", "单个音轨超过 512 MiB，停止且不生成不完整摘要")
                            output.write(block)
                        if not count or (declared and count != int(declared)):
                            raise AudioError("incomplete_download", "音频长度不符，下载不完整")
                    partial.replace(destination)
                    return {"bytes": count, "bandwidth": track.get("bandwidth")}
                except AudioError as error:
                    if error.code not in {"incomplete_download"}:
                        raise
                except (urllib.error.URLError, TimeoutError, OSError, http.client.IncompleteRead):
                    pass
                finally:
                    partial.unlink(missing_ok=True)
            if not refresh:
                time.sleep(2)  # Refresh expiring signatures once, then stop.
        raise AudioError("audio_download_failed", "主备音轨及一次地址刷新均失败，请稍后再试")
    finally:
        partial.unlink(missing_ok=True)


def load_model(model_name):
    try:
        from faster_whisper import WhisperModel
    except ImportError as error:
        raise AudioError("missing_asr", "请用 audio-requirements.txt 安装本地音频依赖，并选择对应 Python 环境") from error
    default_cached = Path.home() / ".cache/media-keeper/whisper-small"
    if model_name == "small" and default_cached.is_dir():
        model_name = str(default_cached)
    return WhisperModel(model_name, device="cpu", compute_type="int8", cpu_threads=4, num_workers=1,
                        download_root=str(Path.home() / ".cache/media-keeper/whisper"))


def transcribe(model, audio, expected, language, vad):
    segments, info = model.transcribe(str(audio), language=None if language == "auto" else language,
                                     beam_size=5, temperature=0, condition_on_previous_text=False, vad_filter=vad)
    rows = [{"start": round(segment.start, 3), "end": round(segment.end, 3), "text": segment.text.strip()}
            for segment in segments if segment.text.strip()]
    duration = float(info.duration)
    if not math.isfinite(duration) or abs(duration - expected) > max(3, expected * .01):
        raise AudioError("incomplete_audio", "解码音频时长与原视频不符，禁止生成完整内容摘要")
    if not rows:
        raise AudioError("no_speech", "完整音轨未识别出可用话语，不能据此编造摘要")
    flags = []
    counts = Counter(row["text"] for row in rows)
    if max(counts.values()) >= 4 and max(counts.values()) > len(rows) / 2:
        flags.append("possible_asr_repetition: 转写重复较多，需核对；不能把模型幻觉当作视频内容")
    return {"duration": round(duration, 3), "language": info.language,
            "language_probability": info.language_probability, "segments": rows, "review_flags": flags}


def cleanup(directory):
    directory = Path(directory).absolute()
    temp_root = Path(tempfile.gettempdir()).resolve()
    if (directory.is_symlink() or directory.parent.resolve() != temp_root or
            not directory.name.startswith(JOB_PREFIX)):
        raise AudioError("unsafe_cleanup", "只允许清理脚本在系统临时目录创建的任务目录")
    if not directory.exists():
        return
    marker = directory / MARKER
    if marker.is_symlink() or not marker.is_file() or marker.read_text() != "media-keeper-bilibili-v1\n":
        raise AudioError("unsafe_cleanup", "任务目录标识不匹配，未删除任何文件")
    try:
        shutil.rmtree(directory)
    except OSError as error:
        raise AudioError("cleanup_failed", "清理未完成，请保留本次目录路径后重试 cleanup：" + str(directory)) from error


def run(value, model_name="small", language="auto", vad=True):
    identifier, query, selected_part, link = parse_video(value)
    pages = get_json(API + "pagelist?" + urllib.parse.urlencode(query))
    if not isinstance(pages, list) or not pages:
        raise AudioError("empty_video", "未找到视频分 P 信息")
    if selected_part is not None:
        pages = [page for page in pages if page.get("page") == selected_part]
        if not pages:
            raise AudioError("missing_part", "指定分 P 不存在")
    for page in pages:
        duration = float(page.get("duration") or 0)
        if not page.get("cid") or not math.isfinite(duration) or duration <= 0:
            raise AudioError("invalid_metadata", "缺少 CID 或完整时长，无法校验音频完整性")
    # Initialize dependencies before creating/downloading any job media.
    model = load_model(model_name)
    directory = Path(tempfile.mkdtemp(prefix=JOB_PREFIX))
    os.chmod(directory, 0o700)
    try:
        (directory / MARKER).write_text("media-keeper-bilibili-v1\n")
        result = {"ok": True, "status": "transcribed", "bvid_or_aid": identifier, "link": link,
                  "source": "哔哩哔哩", "source_type_hint": "video", "title_hint": pages[0].get("part"),
                  "author": None, "source_created_at": None, "parts": [], "full_text_confirmed": False,
                  "review_flags": ["audio_only: 仅据完整音频转写总结，不推断画面、图表或屏幕文字",
                                   "metadata_review: 分 P 标题仅为线索，核对原题；作者和首次发布时间未知时留空"]}
        lines = []
        for page in pages:
            audio = directory / ("part-" + str(page["page"]) + ".m4a")
            try:
                transfer = download_audio(query, page, audio)
                content = transcribe(model, audio, float(page["duration"]), language, vad)
            finally:
                audio.unlink(missing_ok=True)
                audio.with_suffix(".part").unlink(missing_ok=True)
            rows = content.pop("segments")
            result["parts"].append({"page": page["page"], "cid": page["cid"], "title": page.get("part"),
                                    "expected_duration": page["duration"], "segments": len(rows), **transfer, **content})
            result["review_flags"].extend(content["review_flags"])
            lines.append("## P" + str(page["page"]) + " " + str(page.get("part") or ""))
            lines.extend("[{start:.3f}-{end:.3f}] {text}".format(**row) for row in rows)
        transcript = directory / "transcript.txt"
        transcript.write_text("\n".join(lines) + "\n", encoding="utf-8")
        os.chmod(transcript, 0o600)
        result.update(job_dir=str(directory), transcript_path=str(transcript),
                      audio_deleted=True, total_duration=sum(part["duration"] for part in result["parts"]))
        metadata = directory / "metadata.json"
        metadata.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.chmod(metadata, 0o600)
        return result
    except BaseException:
        try:
            shutil.rmtree(directory)
        except OSError as error:
            raise AudioError("cleanup_failed", "处理失败且清理未完成，请重试 cleanup：" + str(directory)) from error
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    fetch = commands.add_parser("transcribe", help="免登录获取完整音轨并本机转写，音频自动删除")
    fetch.add_argument("url")
    fetch.add_argument("--model", default=os.environ.get("MEDIA_KEEPER_WHISPER_MODEL", "small"))
    fetch.add_argument("--language", default="auto")
    fetch.add_argument("--no-vad", action="store_true")
    clean = commands.add_parser("cleanup", help="总结/保存结束后删除任务转写及临时元数据")
    clean.add_argument("job_dir")
    commands.add_parser("doctor", help="检查音频依赖，不下载模型或媒体")
    args = parser.parse_args()
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    try:
        if args.command == "cleanup":
            cleanup(args.job_dir)
            result = {"ok": True, "status": "cleaned"}
        elif args.command == "doctor":
            try:
                import av
                import faster_whisper
            except ImportError as error:
                raise AudioError("missing_asr", "当前 Python 缺少音频依赖，请安装 audio-requirements.txt") from error
            result = {"ok": True, "status": "ready", "python": sys.executable,
                      "faster_whisper": faster_whisper.__version__, "av": av.__version__}
        else:
            result = run(args.url, args.model, args.language, not args.no_vad)
        print(json.dumps(result, ensure_ascii=False))
    except (Exception, KeyboardInterrupt) as error:
        code = getattr(error, "code", None) if isinstance(error, AudioError) else "interrupted" if isinstance(error, KeyboardInterrupt) else "audio_processing_failed"
        message = str(error) if isinstance(error, AudioError) else "音频处理失败或中断，未生成可用摘要；请检查网络和本地音频环境"
        print(json.dumps({"ok": False, "error": {"code": code, "message": message}}, ensure_ascii=False), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
