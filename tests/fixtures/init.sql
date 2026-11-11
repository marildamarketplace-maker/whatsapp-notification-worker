-- TEST ONLY: disposable local PostgreSQL, never run in Supabase.
CREATE TYPE "NotificationType" AS ENUM ('WHATSAPP');
CREATE TYPE "NotificationStatus" AS ENUM ('PENDENTE','ERRO','SUCESSO');
CREATE TABLE notification (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tipo "NotificationType" NOT NULL,
 "to" varchar(30) NOT NULL,titulo text NOT NULL,mensagem text NOT NULL,
 data timestamptz(6) NOT NULL DEFAULT now(),status "NotificationStatus" NOT NULL DEFAULT 'PENDENTE',
 tentativas integer NOT NULL DEFAULT 0,ultimo_erro text,processando_em timestamptz(6),worker_id uuid,
 created_at timestamptz(6) NOT NULL DEFAULT now(),updated_at timestamptz(6) NOT NULL DEFAULT now());
INSERT INTO notification (tipo,"to",titulo,mensagem) VALUES ('WHATSAPP','120363412284116447-group','✅ Teste','Mensagem de teste.');
