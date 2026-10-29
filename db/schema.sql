CREATE DATABASE IF NOT EXISTS student_portal CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE student_portal;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  role ENUM('student','alumni','admin') NOT NULL DEFAULT 'student',
  college_id VARCHAR(40) NULL,
  avatar VARCHAR(255) NULL,
  email_verified_at DATETIME NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS email_tokens (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  type ENUM('verify','reset') NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  INDEX (token_hash),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS alumni_profiles (
  user_id INT UNSIGNED PRIMARY KEY,
  graduation_year SMALLINT NULL,
  degree VARCHAR(120) NULL,
  company VARCHAR(150) NULL,
  job_title VARCHAR(150) NULL,
  bio VARCHAR(500) NULL,
  approved_at DATETIME NULL,
  rejected_at DATETIME NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS events (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(60) NOT NULL,
  venue VARCHAR(150) NOT NULL,
  starts_at DATETIME NOT NULL,
  capacity INT UNSIGNED NOT NULL,
  created_by INT UNSIGNED NULL,
  INDEX (starts_at), INDEX (category),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS registrations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  status ENUM('confirmed','waitlisted','cancelled') NOT NULL,
  registered_at DATETIME NOT NULL,
  checkin_token CHAR(32) NULL,
  checked_in_at DATETIME NULL,
  reminder_sent_at DATETIME NULL,
  UNIQUE KEY uq_checkin_token (checkin_token),
  UNIQUE KEY uq_event_user (event_id, user_id),
  INDEX idx_reg_registered (registered_at),
  INDEX idx_reg_event_status (event_id, status),
  INDEX (user_id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS news (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  author_id INT UNSIGNED NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  company VARCHAR(150) NOT NULL,
  location VARCHAR(150) NOT NULL,
  job_type ENUM('full_time','part_time','internship','contract') NOT NULL,
  description TEXT NOT NULL,
  deadline DATETIME NULL,
  posted_by INT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (posted_by) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS job_applications (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_job_user (job_id, user_id),
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS connections (
  from_user INT UNSIGNED NOT NULL,
  to_user INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (from_user, to_user),
  FOREIGN KEY (from_user) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (to_user) REFERENCES users(id) ON DELETE CASCADE
);
