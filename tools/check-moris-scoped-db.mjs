// Disposable LOCAL PostgreSQL fixture only. Never connects to Supabase.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const container='moris-v6-test',db=`moris_scoped_${Date.now()}`;
const docker=(args,input)=>execFileSync('docker',['exec','-i',container,...args],
  {input,encoding:'utf8',maxBuffer:8*1024*1024}).trim();
const sql=q=>docker(['psql','-U','postgres','-d',db,'-qAt','-v','ON_ERROR_STOP=1'],q);
docker(['createdb','-U','postgres',db]);
try {
  sql(`CREATE EXTENSION vector;
    DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    CREATE TABLE image_library(id uuid PRIMARY KEY,code text,part_id text,usage_side text,
      identifying_features text,view_mode text,is_symmetric boolean,confusing_note text,
      image_path text,updated_at timestamptz);
    CREATE TABLE image_assets(image_id uuid,asset_type text,image_path text,
      storage_provider text,sort_order integer);
    CREATE TABLE catalogue_image_vectors(record_id text,asset_type text,object_key text,
      embedding halfvec(384),hole_count integer,aspect_ratio real,hole_centroids jsonb,
      geometry_evidence jsonb,embedding_signature_version text,is_active boolean,
      embedding_model text,embedding_model_version text,preprocess_version text,
      embedding_profile text);
    CREATE FUNCTION app_session_user_id(text) RETURNS uuid LANGUAGE sql AS $$
      SELECT CASE WHEN $1='valid' THEN '00000000-0000-0000-0000-000000000001'::uuid END
    $$;
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
    GRANT SELECT ON image_library,image_assets,catalogue_image_vectors TO service_role;
    INSERT INTO image_library(id,code,usage_side,view_mode,updated_at)
      VALUES ('00000000-0000-0000-0000-000000000011','MATCH','left','single_face',now()),
             ('00000000-0000-0000-0000-000000000012','FILTERED','right','single_face',now());
    INSERT INTO image_assets VALUES
      ('00000000-0000-0000-0000-000000000011','front','match.webp','r2',0);
    INSERT INTO catalogue_image_vectors VALUES
      ('00000000-0000-0000-0000-000000000011','front','match.webp',
        array_fill(0.1::real,ARRAY[384])::halfvec,2,2.5,'[]'::jsonb,
        '{"geometry_version":"geometry_v1","quality":{"reliable":true}}'::jsonb,
        'moris384_geometry_v1',true,'test','1','v3','hybrid'),
      ('00000000-0000-0000-0000-000000000012','front','other.webp',
        array_fill(0.1::real,ARRAY[384])::halfvec,1,3,'[]'::jsonb,
        '{"geometry_version":"geometry_v1","quality":{"reliable":true}}'::jsonb,
        'moris384_geometry_v1',true,'test','1','v3','hybrid');`);
  sql(readFileSync('supabase/migrations/20261021051000_moris_scoped_match_keyed_hydration.sql','utf8'));
  const match=sql(`SET ROLE service_role;
    SELECT record_id FROM match_catalogue_image_vectors_scoped_v1(
      array_fill(0.1::real,ARRAY[384])::halfvec,'test','1','v3','hybrid',
      ARRAY['00000000-0000-0000-0000-000000000011'],10);`);
  if(match!=='00000000-0000-0000-0000-000000000011')throw Error('Scoped match escaped allowlist');
  const filtered=sql(`SELECT id FROM app_filter_catalogue_ids_moris_v1('valid',
    ARRAY['00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000012']::uuid[],'left','all');`);
  if(filtered!=='00000000-0000-0000-0000-000000000011')throw Error('Session filter escaped usage');
  const hydrated=sql(`SELECT code,front_path FROM app_get_catalogue_by_ids_moris_v1('valid',
    ARRAY['00000000-0000-0000-0000-000000000011']::uuid[],'left','all');`);
  if(hydrated!=='MATCH|match.webp')throw Error('Keyed hydration omitted asset');
  sql(`DO $$ BEGIN
    PERFORM * FROM app_get_catalogue_by_ids_moris_v1('invalid',ARRAY['00000000-0000-0000-0000-000000000011']::uuid[]);
    RAISE EXCEPTION 'invalid token accepted';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'UNAUTHORIZED' THEN RAISE; END IF;
  END $$;`);
  if(sql(`SELECT has_function_privilege('anon',
    'match_catalogue_image_vectors_scoped_v1(halfvec,text,text,text,text,text[],integer)','EXECUTE');`)!=='f')
    throw Error('Public scoped vector RPC privilege');
  console.log(JSON.stringify({scoped_match:true,session_filter:true,keyed_hydration:true,
    unauthorized_rejected:true,public_vector_rpc_denied:true,production_writes:0}));
} finally {docker(['dropdb','-U','postgres',db]);}
