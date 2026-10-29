-- ReleaseReady database tables. Run this once in the Supabase SQL editor of a new project.
create table public.testers (id text primary key, name text not null, position int not null default 0, created_at timestamptz not null default now());
create table public.steps (id text primary key, scenario text not null, screen text not null default '', action text not null, expected text not null, position int not null default 0, assigned text[] not null default '{}', created_at timestamptz not null default now());
create table public.results (id text primary key, tester text not null, step text not null, result text not null check (result in ('pass','fail')), screenshot boolean not null default false, env text not null default '', screenshot_data text, created_at timestamptz not null default now());
create table public.feedback (id text primary key, result_id text not null, tester text not null, step text not null, category text not null check (category in ('bug','nonbug')), body text not null, is_primary boolean not null default false, seq int not null default 0, needs_detail boolean not null default false, created_at timestamptz not null default now());
create table public.messages (id text primary key, feedback_id text not null, sender text not null check (sender in ('manager','tester')), body text not null, sent_at text not null default '', position int not null default 0, created_at timestamptz not null default now());
create table public.notifications (id text primary key, recipient text not null, kind text not null, body text not null, ref jsonb not null default '{}', sent_at text not null default '', is_read boolean not null default false, position int not null default 0, created_at timestamptz not null default now());
create table public.decisions (feedback_id text primary key, member text, known text, known_ticket text, idea text, selected boolean, checked boolean not null default false, sent_text text, needs_correction boolean not null default false, updated_at timestamptz not null default now());
create table public.group_decisions (anchor_id text primary key, merged boolean, updated_at timestamptz not null default now());
create table public.tickets (key text primary key, summary text not null, type text not null default 'Bug', priority text not null default 'Medium', epic text not null default '', status text not null default 'To do', source text not null default 'UAT', links int not null default 0, reopened boolean not null default false, problem_id text, details jsonb, evidence jsonb, position int not null default 0, created_at timestamptz not null default now());
create table public.drafts (problem_id text primary key, fields jsonb not null, updated_at timestamptz not null default now());
create table public.settings (key text primary key, value jsonb, updated_at timestamptz not null default now());

-- Prototype access: there is no login, so the app's publishable key may read and write these tables.
do $$
declare t text;
begin
  foreach t in array array['testers','steps','results','feedback','messages','notifications','decisions','group_decisions','tickets','drafts','settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "prototype full access" on public.%I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;
