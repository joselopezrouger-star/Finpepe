-- FinPep — programación de las notificaciones push.
-- Reemplazá TU_CRON_SECRET (2 veces abajo, y 1 en el trigger) por el mismo
-- valor que cargaste en los Secrets de la Edge Function, y corré todo en el
-- SQL Editor. Se puede volver a correr: primero borra lo que haya.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Borra programaciones anteriores (si existen) para no duplicarlas.
select cron.unschedule(jobname) from cron.job
 where jobname in ('finpep-notify-daily', 'finpep-notify-reminder');

-- 9:00 de Argentina (12:00 UTC): vencimientos, alertas de tope y fijos.
select cron.schedule('finpep-notify-daily', '0 12 * * *', $$
  select net.http_post(
    url := 'https://fwldbohbsohuzxyxpqte.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'TU_CRON_SECRET'),
    body := '{"action":"daily"}'::jsonb
  );
$$);

-- 21:00 de Argentina (00:00 UTC): recordatorio si no cargaste nada en el día.
select cron.schedule('finpep-notify-reminder', '0 0 * * *', $$
  select net.http_post(
    url := 'https://fwldbohbsohuzxyxpqte.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'TU_CRON_SECRET'),
    body := '{"action":"reminder"}'::jsonb
  );
$$);

-- Aviso inmediato a la pareja cuando alguien carga un gasto compartido.
create or replace function public.finpep_notify_shared_expense()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://fwldbohbsohuzxyxpqte.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'TU_CRON_SECRET'),
    body := jsonb_build_object('action', 'shared', 'record', to_jsonb(new))
  );
  return new;
end;
$$;
revoke all on function public.finpep_notify_shared_expense() from public, anon, authenticated;

drop trigger if exists finpep_shared_expense_notify on public.shared_expenses;
create trigger finpep_shared_expense_notify
  after insert on public.shared_expenses
  for each row execute function public.finpep_notify_shared_expense();
