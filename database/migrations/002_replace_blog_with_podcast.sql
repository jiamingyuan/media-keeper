-- The former blog value classified website articles. Keep those records as article.
-- Expand before backfilling so strict ENUM validation never loses a record.
ALTER TABLE agent.useful_docs
  MODIFY COLUMN source_type ENUM('article','paper','blog','video','tech_doc','project_repo','podcast') NOT NULL;

UPDATE agent.useful_docs
  SET source_type = 'article', updated_at = updated_at
  WHERE source_type = 'blog';

ALTER TABLE agent.useful_docs
  MODIFY COLUMN source_type ENUM('article','paper','podcast','video','tech_doc','project_repo') NOT NULL;
