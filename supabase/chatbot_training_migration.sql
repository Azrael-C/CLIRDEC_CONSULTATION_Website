-- Admin-managed example phrases for the controlled spaCy/FAQ assistant.
-- Existing approved answers remain valid; administrators can add phrases
-- gradually through the Chatbot Training workspace.

alter table public.faq_entries
  add column if not exists training_phrases text[] not null default '{}';

comment on column public.faq_entries.training_phrases is
  'Product Owner-approved example questions used only for retrieval matching.';

-- Bound the data stored with one knowledge entry. The frontend applies
-- stricter validation, while this check also protects direct API writes.
alter table public.faq_entries
  drop constraint if exists faq_training_phrases_limit;

alter table public.faq_entries
  add constraint faq_training_phrases_limit
  check (cardinality(training_phrases) <= 20);
