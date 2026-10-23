ALTER TABLE agent.useful_docs
  MODIFY COLUMN source_type ENUM('article','paper','blog','video','tech_doc','project_repo') NOT NULL;
