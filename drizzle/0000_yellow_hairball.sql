CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`segment` text NOT NULL,
	`arr_cents` integer DEFAULT 0 NOT NULL,
	`renewal_date` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`stage` text NOT NULL,
	`provider` text NOT NULL,
	`model_id` text NOT NULL,
	`prompt_version` text NOT NULL,
	`input_hash` text NOT NULL,
	`output_json` text NOT NULL,
	`confidence` real,
	`latency_ms` integer NOT NULL,
	`tokens` integer,
	`request_id` text,
	`problem_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ai_decisions_stage_idx` ON `ai_decisions` (`stage`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_decisions_request_idx` ON `ai_decisions` (`request_id`);--> statement-breakpoint
CREATE TABLE `dedupe_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`candidate_problem_id` text NOT NULL,
	`similarity` real NOT NULL,
	`verdict` text NOT NULL,
	`verdict_confidence` real,
	`rationale` text,
	`human_action` text,
	`created_at` integer NOT NULL,
	`acted_at` integer,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`candidate_problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `dedupe_request_idx` ON `dedupe_suggestions` (`request_id`);--> statement-breakpoint
CREATE TABLE `evidence_links` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`problem_id` text NOT NULL,
	`created_by` text NOT NULL,
	`confidence` real,
	`suggestion_id` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `evidence_problem_idx` ON `evidence_links` (`problem_id`,`active`);--> statement-breakpoint
CREATE INDEX `evidence_request_idx` ON `evidence_links` (`request_id`);--> statement-breakpoint
CREATE TABLE `human_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`field` text NOT NULL,
	`suggested_value` text,
	`final_value` text,
	`reason` text,
	`actor` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `overrides_target_idx` ON `human_overrides` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `problem_links` (
	`id` text PRIMARY KEY NOT NULL,
	`problem_a_id` text NOT NULL,
	`problem_b_id` text NOT NULL,
	`kind` text DEFAULT 'related' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`problem_a_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`problem_b_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `problem_links_pair_idx` ON `problem_links` (`problem_a_id`,`problem_b_id`);--> statement-breakpoint
CREATE TABLE `problems` (
	`id` text PRIMARY KEY NOT NULL,
	`statement` text NOT NULL,
	`job_to_be_done` text NOT NULL,
	`current_workaround` text NOT NULL,
	`blocked_outcome` text NOT NULL,
	`embedding` blob,
	`embedding_model` text,
	`merged_into_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `problems_merged_into_idx` ON `problems` (`merged_into_id`);--> statement-breakpoint
CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body_raw` text NOT NULL,
	`submitter_kind` text NOT NULL,
	`account_id` text,
	`resolution` text,
	`degraded` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`triaged_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `requests_account_idx` ON `requests` (`account_id`);--> statement-breakpoint
CREATE TABLE `score_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`problem_id` text NOT NULL,
	`weights_version` text NOT NULL,
	`factors_json` text NOT NULL,
	`raw_score` real NOT NULL,
	`band` text NOT NULL,
	`confidence` real,
	`model_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `score_runs_problem_idx` ON `score_runs` (`problem_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `supports` (
	`id` text PRIMARY KEY NOT NULL,
	`problem_id` text NOT NULL,
	`account_id` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supports_problem_account_idx` ON `supports` (`problem_id`,`account_id`);