import importlib.util
import io
import json
from pathlib import Path
import shutil
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import urllib.error

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/bilibili.py"
spec = importlib.util.spec_from_file_location("bilibili", SCRIPT)
bili = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bili)
BV = "BV1v34y1j7Nu"


class Response(io.BytesIO):
    def __init__(self, value, declared=None):
        super().__init__(value)
        self.headers = {"Content-Length": str(len(value) if declared is None else declared)}


class BilibiliTests(unittest.TestCase):
    def setUp(self):
        self.jobs = []
        original = tempfile.mkdtemp

        def make_job(*args, **kwargs):
            directory = original(*args, **kwargs)
            self.jobs.append(Path(directory))
            return directory

        self.job_patch = patch.object(bili.tempfile, "mkdtemp", side_effect=make_job)
        self.job_patch.start()
        self.addCleanup(self.job_patch.stop)
        self.addCleanup(lambda: [shutil.rmtree(job, ignore_errors=True) for job in self.jobs])

    def pages(self):
        return [{"page": 1, "cid": 11, "duration": 10, "part": "开篇"},
                {"page": 2, "cid": 12, "duration": 20, "part": "最后结论"}]

    def download(self, query, page, audio):
        self.assertEqual(list(audio.parent.glob("*.m4a")), [])
        audio.write_bytes(b"audio")
        return {"bytes": 5, "bandwidth": 65000}

    def model(self):
        def transcribe(file, **options):
            duration = 10 if "part-1" in file else 20
            rows = iter([SimpleNamespace(start=0, end=duration, text="开头观点" if duration == 10 else "最后结论")])
            return rows, SimpleNamespace(duration=duration, language="zh", language_probability=.99)
        return SimpleNamespace(transcribe=transcribe)

    def run_video(self, **kwargs):
        with patch.object(bili, "get_json", return_value=self.pages()), \
             patch.object(bili, "load_model", return_value=self.model()), \
             patch.object(bili, "download_audio", side_effect=self.download):
            return bili.run(BV, **kwargs)

    def test_normalizes_video_links_but_retains_selected_part(self):
        identifier, query, page, url = bili.parse_video("https://www.bilibili.com/zh-Hans/video/" + BV + "/?p=2&spm_id_from=test")
        self.assertEqual((identifier, query, page), (BV, {"bvid": BV}, 2))
        self.assertEqual(url, "https://www.bilibili.com/video/" + BV + "/?p=2")
        self.assertEqual(bili.parse_video("av123")[1], {"aid": "123"})
        for bad in ["https://bilibili.com.example.org/video/" + BV, "https://www.bilibili.com/video/" + BV + "?p=0"]:
            with self.assertRaises(bili.AudioError):
                bili.parse_video(bad)

    def test_requests_use_anonymous_playback_headers(self):
        def open_url(req, timeout):
            headers = {key.lower(): value for key, value in req.header_items()}
            self.assertEqual(headers["referer"], "https://www.bilibili.com/")
            self.assertEqual(headers["user-agent"], "Mozilla/5.0")
            self.assertNotIn("cookie", headers)
            return Response(b"audio")
        with patch.object(bili.urllib.request, "urlopen", side_effect=open_url):
            with bili.request("https://cdn.example.org/audio?deadline=123&upsig=abc") as response:
                self.assertEqual(response.read(), b"audio")

    def test_all_parts_consumed_audio_removed_then_transcript_cleaned(self):
        result = self.run_video()
        job = Path(result["job_dir"])
        transcript = Path(result["transcript_path"]).read_text()
        self.assertIn("开头观点", transcript)
        self.assertIn("最后结论", transcript)
        self.assertEqual(result["total_duration"], 30)
        self.assertFalse(result["full_text_confirmed"])
        self.assertEqual({file.name for file in job.iterdir()}, {bili.MARKER, "metadata.json", "transcript.txt"})
        bili.cleanup(job)
        bili.cleanup(job)  # Retry is safe.
        self.assertFalse(job.exists())

    def test_selected_part_does_not_fetch_other_parts(self):
        with patch.object(bili, "get_json", return_value=self.pages()), \
             patch.object(bili, "load_model", return_value=self.model()), \
             patch.object(bili, "download_audio", side_effect=self.download) as download:
            result = bili.run("https://www.bilibili.com/video/" + BV + "/?p=2")
        self.assertEqual(download.call_count, 1)
        self.assertEqual([part["page"] for part in result["parts"]], [2])

    def test_transcription_failure_and_interrupt_remove_entire_job(self):
        for error in [bili.AudioError("asr_failed", "识别失败"), KeyboardInterrupt()]:
            with patch.object(bili, "get_json", return_value=self.pages()), \
                 patch.object(bili, "load_model", return_value=self.model()), \
                 patch.object(bili, "download_audio", side_effect=self.download), \
                 patch.object(bili, "transcribe", side_effect=error):
                with self.assertRaises(type(error)):
                    bili.run(BV)
            self.assertTrue(self.jobs)
            self.assertTrue(all(not job.exists() for job in self.jobs))

    def test_incomplete_and_silent_audio_are_not_accepted(self):
        for duration, rows, code in [(5, [SimpleNamespace(start=0, end=5, text="片段")], "incomplete_audio"), (10, [], "no_speech")]:
            model = SimpleNamespace(transcribe=lambda *a, **k: (iter(rows), SimpleNamespace(duration=duration, language="zh", language_probability=.99)))
            with self.assertRaises(bili.AudioError) as caught:
                bili.transcribe(model, Path("audio.m4a"), 10, "auto", True)
            self.assertEqual(caught.exception.code, code)

    def test_lowest_bandwidth_signed_url_and_backup_are_used(self):
        directory = Path(tempfile.mkdtemp(prefix=bili.JOB_PREFIX))
        primary = "https://cdn.example.org/audio?deadline=1&upsig=original"
        backup = "https://backup.example.org/audio?deadline=1&upsig=backup"
        track = {"base_url": primary, "backup_url": [backup], "bandwidth": 65000, "id": 999}
        play = {"dash": {"audio": [{"baseUrl": "https://unused.example.org/", "bandwidth": 128000}, track]}}
        urls = []

        def fetch(url):
            urls.append(url)
            if url == primary:
                return Response(b"short", declared=100)
            return Response(b"complete")
        with patch.object(bili, "get_json", return_value=play), patch.object(bili, "request", side_effect=fetch):
            result = bili.download_audio({"bvid": BV}, self.pages()[0], directory / "audio.m4a")
        self.assertEqual(urls, [primary, backup])
        self.assertEqual(result["bytes"], 8)
        self.assertFalse((directory / "audio.part").exists())

    def test_expired_addresses_are_refreshed_once(self):
        directory = Path(tempfile.mkdtemp(prefix=bili.JOB_PREFIX))
        old, new = "https://cdn.example.org/expired", "https://cdn.example.org/fresh"
        replies = [{"dash": {"audio": [{"baseUrl": url, "bandwidth": 1}]}} for url in [old, new]]

        def fetch(url):
            if url == old:
                raise urllib.error.HTTPError(url, 403, "expired", {}, None)
            return Response(b"complete")
        with patch.object(bili, "get_json", side_effect=replies) as api, \
             patch.object(bili, "request", side_effect=fetch), patch.object(bili.time, "sleep"):
            bili.download_audio({"bvid": BV}, self.pages()[0], directory / "audio.m4a")
        self.assertEqual(api.call_count, 2)

    def test_preview_audio_is_rejected(self):
        for play in [{"is_preview": True}, {"timelength": 1000}]:
            with patch.object(bili, "get_json", return_value=play):
                with self.assertRaises(bili.AudioError) as caught:
                    bili.download_audio({"bvid": BV}, self.pages()[0], Path("unused.m4a"))
            self.assertEqual(caught.exception.code, "preview_only")

    def test_cleanup_refuses_unrelated_directories_and_symlinks(self):
        directory = Path(tempfile.mkdtemp(prefix=bili.JOB_PREFIX))
        marker = directory / bili.MARKER
        marker.write_text("not-a-job")
        for target in [directory, Path.home()]:
            with self.assertRaises(bili.AudioError):
                bili.cleanup(target)
        marker.write_text("media-keeper-bilibili-v1\n")
        alias = directory.parent / (directory.name + "-alias")
        alias.symlink_to(directory)
        self.addCleanup(alias.unlink)
        with self.assertRaises(bili.AudioError):
            bili.cleanup(alias)
        self.assertTrue(directory.exists())

    def test_failed_cleanup_is_reported_instead_of_claiming_success(self):
        result = self.run_video()
        job = Path(result["job_dir"])
        with patch.object(bili.shutil, "rmtree", side_effect=PermissionError("busy")):
            with self.assertRaises(bili.AudioError) as caught:
                bili.cleanup(job)
        self.assertEqual(caught.exception.code, "cleanup_failed")
        self.assertIn(str(job), str(caught.exception))
        self.assertTrue(job.exists())


if __name__ == "__main__":
    unittest.main()
