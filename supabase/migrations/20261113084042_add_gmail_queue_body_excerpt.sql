alter table jobbot.gmail_processing_queue add column if not exists body_excerpt text;
comment on column jobbot.gmail_processing_queue.body_excerpt is 'Plain-text excerpt (max ~4000 chars) of the message for classification. Not the raw MIME body.';
