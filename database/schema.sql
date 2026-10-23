CREATE TABLE IF NOT EXISTS agent.useful_docs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(512) NOT NULL,
  abstract TEXT NOT NULL,
  link TEXT NULL,
  copied_lark_link TEXT NULL,
  source VARCHAR(255) NOT NULL,
  source_type ENUM('article','paper','podcast','video','tech_doc','project_repo') NOT NULL,
  author TEXT NULL,
  source_created_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX useful_docs_source_title (source(100), title(150)),
  CONSTRAINT useful_docs_abstract_length CHECK (CHAR_LENGTH(TRIM(abstract)) BETWEEN 1 AND 400),
  CONSTRAINT useful_docs_title_present CHECK (CHAR_LENGTH(TRIM(title)) > 0),
  CONSTRAINT useful_docs_source_present CHECK (CHAR_LENGTH(TRIM(source)) > 0),
  CONSTRAINT useful_docs_entrypoint CHECK (COALESCE(CHAR_LENGTH(TRIM(link)),0) > 0 OR COALESCE(CHAR_LENGTH(TRIM(copied_lark_link)),0) > 0),
  CONSTRAINT useful_docs_valid_type CHECK (source_type + 0 > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
