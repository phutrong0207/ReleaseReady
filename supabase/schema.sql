-- ReleaseReady database tables. Run this once in the Supabase SQL editor of a new project.
-- Every row belongs to one test cycle (the cycle column). The cycles table lists the test cycles.
create table public.cycles (id text primary key, name text not null default '', app text not null default '', status text not null default 'active', created text, ended text, stats jsonb, people jsonb, position int not null default 0, created_at timestamptz not null default now());
create table public.testers (cycle text not null default 'c1', id text not null, name text not null, position int not null default 0, created_at timestamptz not null default now(), primary key (cycle, id));
create table public.steps (cycle text not null default 'c1', id text not null, scenario text not null, screen text not null default '', action text not null, expected text not null, position int not null default 0, assigned text[] not null default '{}', created_at timestamptz not null default now(), primary key (cycle, id));
create table public.results (cycle text not null default 'c1', id text not null, tester text not null, step text not null, result text not null check (result in ('pass','fail')), screenshot boolean not null default false, env text not null default '', screenshot_data text, created_at timestamptz not null default now(), primary key (cycle, id));
create table public.feedback (cycle text not null default 'c1', id text not null, result_id text not null, tester text not null, step text not null, category text not null check (category in ('bug','nonbug')), body text not null, is_primary boolean not null default false, seq int not null default 0, needs_detail boolean not null default false, edited_at text, created_at timestamptz not null default now(), primary key (cycle, id));
create table public.messages (cycle text not null default 'c1', id text not null, feedback_id text not null, sender text not null check (sender in ('manager','tester')), body text not null, sent_at text not null default '', position int not null default 0, image text, created_at timestamptz not null default now(), primary key (cycle, id));
create table public.notifications (cycle text not null default 'c1', id text not null, recipient text not null, kind text not null, body text not null, ref jsonb not null default '{}', sent_at text not null default '', is_read boolean not null default false, position int not null default 0, created_at timestamptz not null default now(), primary key (cycle, id));
create table public.decisions (cycle text not null default 'c1', feedback_id text not null, member text, known text, known_ticket text, idea text, selected boolean, checked boolean not null default false, sent_text text, needs_correction boolean not null default false, approved text, updated_at timestamptz not null default now(), primary key (cycle, feedback_id));
create table public.group_decisions (cycle text not null default 'c1', anchor_id text not null, merged boolean, updated_at timestamptz not null default now(), primary key (cycle, anchor_id));
create table public.tickets (cycle text not null default 'c1', key text not null, summary text not null, type text not null default 'Bug', priority text not null default 'Medium', epic text not null default '', status text not null default 'To do', source text not null default 'UAT', links int not null default 0, reopened boolean not null default false, problem_id text, details jsonb, evidence jsonb, position int not null default 0, created_at timestamptz not null default now(), primary key (cycle, key));
create table public.drafts (cycle text not null default 'c1', problem_id text not null, fields jsonb not null, updated_at timestamptz not null default now(), primary key (cycle, problem_id));
create table public.chat_messages (cycle text not null default 'c1', id text not null, problem_id text not null, sender text not null, body text not null, sent_at text not null default '', position int not null default 0, image text, created_at timestamptz not null default now(), primary key (cycle, id));
create table public.settings (cycle text not null default 'c1', key text not null, value jsonb, updated_at timestamptz not null default now(), primary key (cycle, key));

-- Prototype access: there is no login, so the app's publishable key may read and write these tables.
do $$
declare t text;
begin
  foreach t in array array['testers','steps','results','feedback','messages','notifications','decisions','group_decisions','tickets','drafts','settings','chat_messages','cycles'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "prototype full access" on public.%I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;
