import type { SourceType } from '@media-keeper/core'
import type { CSSProperties } from 'react'
import article from './assets/article.svg'
import paper from './assets/paper.svg'
import podcast from './assets/podcast.svg'
import video from './assets/video.svg'
import techDoc from './assets/tech_doc.svg'
import projectRepo from './assets/project_repo.svg'
import arrow from './assets/arrow.svg'
import styles from './Media.module.css'

const icons = { article, paper, podcast, video, tech_doc: techDoc, project_repo: projectRepo, arrow }
export function SourceIcon({ type }: { type: SourceType | 'arrow' }) {
  return <span aria-hidden="true" className={styles.icon} style={{ '--media-icon': `url("${icons[type]}")` } as CSSProperties} />
}
