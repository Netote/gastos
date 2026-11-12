-- Tarea semanal del aviso push. Ejecútala UNA vez en Supabase → SQL Editor, después de desplegar la función
-- `weekly-push` (pasos en el README, sección «Aviso semanal»).
--
-- Antes de ejecutar, cambia los dos valores marcados:
--   TU-PROYECTO    → el identificador de tu proyecto (lo que va antes de .supabase.co en tu URL).
--   TU-CRON-SECRET → el mismo valor que guardaste como secreto CRON_SECRET de la función.
-- No subas este archivo a GitHub con tus valores reales.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Si ya existía, se reemplaza.
select cron.unschedule(jobid) from cron.job where jobname = 'gastos-reporte-semanal';

-- Lunes a las 15:00 UTC = 9:00 a. m. en Ciudad de México.
select cron.schedule(
  'gastos-reporte-semanal',
  '0 15 * * 1',
  $$
  select net.http_post(
    url := 'https://TU-PROYECTO.supabase.co/functions/v1/weekly-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'TU-CRON-SECRET'),
    body := '{}'::jsonb
  );
  $$
);

-- Para comprobar que quedó programada:  select jobname, schedule, active from cron.job;
-- Para quitarla:  select cron.unschedule('gastos-reporte-semanal');
