-- VANIFS uses VANTIS's existing Supabase project and individual auth.users.
-- No inventory table, policy or historical row is modified by this migration.
CREATE SCHEMA vanifs_private;
REVOKE ALL ON SCHEMA vanifs_private FROM PUBLIC, anon, authenticated;

CREATE TABLE vanifs_private.operators (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 140),
  role text NOT NULL CHECK (role IN ('admin','supervisor','collaborator')),
  can_close boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  employee_number text CHECK (employee_number ~ '^[0-9]{4,12}$'),
  owner boolean NOT NULL DEFAULT false CHECK (NOT owner OR role='admin')
);

CREATE TABLE vanifs_private.journeys (
  id uuid PRIMARY KEY,
  work_date date NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 140),
  file text NOT NULL CHECK (length(file) <= 140),
  fingerprint text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by text NOT NULL,
  paused_at timestamptz,
  closed_at timestamptz,
  closed_by text,
  note text NOT NULL DEFAULT '',
  canceled boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expected bigint NOT NULL DEFAULT 0 CHECK (expected >= 0),
  line_count integer NOT NULL DEFAULT 0,
  box_count integer NOT NULL DEFAULT 0,
  manifest_count integer NOT NULL DEFAULT 0,
  totals jsonb,
  UNIQUE (work_date, fingerprint)
);
CREATE INDEX vanifs_journeys_recent ON vanifs_private.journeys(created_at DESC, id DESC);
CREATE INDEX vanifs_open_by_date ON vanifs_private.journeys(work_date DESC) WHERE closed_at IS NULL AND NOT archived;

CREATE TABLE vanifs_private.lines (
  journey_id uuid NOT NULL REFERENCES vanifs_private.journeys(id),
  line_no integer NOT NULL CHECK (line_no>=0),
  row_data jsonb NOT NULL,
  sku text NOT NULL,
  upc text NOT NULL,
  box text NOT NULL,
  expected integer NOT NULL CHECK (expected BETWEEN 1 AND 100000),
  received integer NOT NULL DEFAULT 0 CHECK (received BETWEEN 0 AND expected),
  PRIMARY KEY (journey_id,line_no)
);
CREATE INDEX vanifs_line_sku ON vanifs_private.lines(journey_id,sku,box,line_no) WHERE sku<>'';
CREATE INDEX vanifs_line_upc ON vanifs_private.lines(journey_id,upc,box,line_no) WHERE upc<>'';
CREATE INDEX vanifs_line_box ON vanifs_private.lines(journey_id,box);

CREATE TABLE vanifs_private.events (
  id uuid PRIMARY KEY,
  journey_id uuid NOT NULL REFERENCES vanifs_private.journeys(id),
  seq bigint NOT NULL,
  body jsonb NOT NULL,
  kind text NOT NULL CHECK (kind IN ('box','piece','issue','undo','verify')),
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  device_id uuid,
  device text NOT NULL,
  recorded_at timestamptz NOT NULL,
  box text NOT NULL,
  result text NOT NULL,
  acknowledged_result text NOT NULL,
  acknowledged_sku text,
  line_no integer,
  sku text,
  reversed_by uuid REFERENCES vanifs_private.events(id),
  UNIQUE (journey_id,seq),
  FOREIGN KEY (journey_id,line_no) REFERENCES vanifs_private.lines(journey_id,line_no)
);
CREATE INDEX vanifs_active_box ON vanifs_private.events(journey_id,actor_id,device_id,box) WHERE kind='box';
CREATE INDEX vanifs_actor_scans ON vanifs_private.events(journey_id,actor_id,seq);
CREATE INDEX vanifs_live_pieces ON vanifs_private.events(journey_id,seq DESC) WHERE kind='piece' AND reversed_by IS NULL;

CREATE TABLE vanifs_private.participants (
  journey_id uuid NOT NULL REFERENCES vanifs_private.journeys(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  revoked boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (journey_id,user_id)
);
CREATE TABLE vanifs_private.devices (
  journey_id uuid NOT NULL,
  user_id uuid NOT NULL,
  device_id uuid NOT NULL,
  label text NOT NULL,
  pending integer NOT NULL CHECK (pending BETWEEN 0 AND 100000),
  box text NOT NULL DEFAULT '',
  seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (journey_id,user_id,device_id),
  FOREIGN KEY (journey_id,user_id) REFERENCES vanifs_private.participants(journey_id,user_id)
);
CREATE TABLE vanifs_private.leases (
  journey_id uuid NOT NULL REFERENCES vanifs_private.journeys(id),
  box text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (journey_id,box)
);
CREATE TABLE vanifs_private.activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id uuid NOT NULL REFERENCES vanifs_private.journeys(id),
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  action text NOT NULL,
  detail text NOT NULL,
  device text NOT NULL,
  at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX vanifs_activity_journey ON vanifs_private.activity(journey_id,at,id);
CREATE TABLE vanifs_private.invites (
  fingerprint bytea PRIMARY KEY,
  email text NOT NULL CHECK (email ~ '^[^@]+@(gmail\.com|liverpool\.com\.mx)$'),
  name text,
  role text NOT NULL CHECK (role IN ('admin','supervisor','collaborator')),
  can_close boolean NOT NULL,
  journey_id uuid NOT NULL REFERENCES vanifs_private.journeys(id),
  issued_by uuid NOT NULL REFERENCES auth.users(id),
  expires_at timestamptz NOT NULL,
  accepted_by uuid REFERENCES auth.users(id),
  accepted_at timestamptz
);
CREATE TABLE vanifs_private.transfers (
  journey_id uuid NOT NULL REFERENCES vanifs_private.journeys(id),
  sku text NOT NULL,
  movement_id uuid NOT NULL UNIQUE,
  department_id uuid NOT NULL,
  marbete text NOT NULL,
  qty integer NOT NULL CHECK(qty>0),
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(journey_id,sku)
);
CREATE TABLE vanifs_private.legacy_backups (
  fingerprint bytea PRIMARY KEY,
  source jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- This is the only table exposed to PostgREST/Realtime. It has no manifest data.
CREATE TABLE public.vanifs_revisions (
  journey_id uuid PRIMARY KEY REFERENCES vanifs_private.journeys(id),
  stamp bigint NOT NULL DEFAULT 0
);
ALTER TABLE public.vanifs_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vanifs_revisions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vanifs_revisions TO authenticated;

CREATE FUNCTION vanifs_private.account()
RETURNS vanifs_private.operators LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT o.* FROM vanifs_private.operators o JOIN auth.users u ON u.id=o.user_id
  WHERE o.user_id=(SELECT auth.uid()) AND o.active AND u.email_confirmed_at IS NOT NULL
    AND lower(u.email) ~ '^[^@]+@(gmail\.com|liverpool\.com\.mx)$'
$$;

CREATE FUNCTION vanifs_private.may_read(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS (
    SELECT 1 FROM vanifs_private.journeys j CROSS JOIN vanifs_private.account() a
    LEFT JOIN vanifs_private.participants p ON p.journey_id=j.id AND p.user_id=a.user_id
    WHERE j.id=p_id AND a.user_id IS NOT NULL AND NOT coalesce(p.revoked,false)
      AND (a.role<>'collaborator' OR (j.closed_at IS NULL AND NOT j.archived) OR p.user_id IS NOT NULL)
  )
$$;
REVOKE ALL ON FUNCTION vanifs_private.may_read(uuid) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA vanifs_private TO authenticated;
GRANT EXECUTE ON FUNCTION vanifs_private.may_read(uuid) TO authenticated;
CREATE POLICY vanifs_revisions_read ON public.vanifs_revisions FOR SELECT TO authenticated
  USING (vanifs_private.may_read(journey_id));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime' AND NOT puballtables)
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='vanifs_revisions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.vanifs_revisions;
  END IF;
END $$;

CREATE FUNCTION vanifs_private.touch(p_id uuid)
RETURNS void LANGUAGE sql SET search_path='' AS $$
  INSERT INTO public.vanifs_revisions(journey_id) VALUES(p_id)
  ON CONFLICT(journey_id) DO UPDATE SET stamp=vanifs_revisions.stamp+1
$$;

CREATE FUNCTION vanifs_private.log(p_id uuid, p_actor vanifs_private.operators, p_action text, p_detail text, p_device text)
RETURNS void LANGUAGE sql SET search_path='' AS $$
  INSERT INTO vanifs_private.activity(journey_id,actor_id,actor_name,action,detail,device)
  VALUES(p_id,p_actor.user_id::text,p_actor.name,p_action,p_detail,p_device)
$$;

CREATE FUNCTION vanifs_private.receipt(j vanifs_private.journeys)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT jsonb_build_object('id',j.id,'date',j.work_date,'title',j.title,'file',j.file,
    'createdAt',j.created_at,'createdBy',j.created_by,'pausedAt',j.paused_at,'closedAt',j.closed_at,
    'closedBy',j.closed_by,'note',j.note,'expected',j.expected,'lineCount',j.line_count,
    'boxCount',j.box_count,'manifestCount',j.manifest_count,'revision',j.revision,'totals',j.totals,
    'canceled',j.canceled,'archived',j.archived,'updatedAt',j.updated_at)
$$;

CREATE FUNCTION vanifs_private.totals(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT jsonb_build_object(
    'expected',j.expected,'scanned',count(*) FILTER(WHERE e.kind='piece'),
    'matched',count(*) FILTER(WHERE e.result='Recibida'),
    'missing',j.expected-count(*) FILTER(WHERE e.result='Recibida'),
    'extra',count(*) FILTER(WHERE e.result='Sobrante'),
    'unknown',count(*) FILTER(WHERE e.result='Fuera de manifiesto'),
    'wrongBox',count(*) FILTER(WHERE e.result='Otra caja'),
    'manual',coalesce(sum((e.body->>'qty')::integer) FILTER(WHERE e.kind='issue'),0))
  FROM vanifs_private.journeys j
  LEFT JOIN vanifs_private.events e ON e.journey_id=j.id AND e.reversed_by IS NULL
  WHERE j.id=p_id GROUP BY j.expected
$$;

CREATE FUNCTION vanifs_private.live(j vanifs_private.journeys)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT jsonb_build_object('seq',j.revision,
    'totals',coalesce(j.totals,vanifs_private.totals(j.id)),
    'processed',(SELECT count(*) FROM (
      SELECT box FROM vanifs_private.lines WHERE journey_id=j.id AND box<>'' GROUP BY box HAVING sum(received)=sum(expected)
    ) complete),
    'people',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.last DESC) FROM (
      SELECT actor_id AS id,max(actor_name) AS name,count(*) FILTER(WHERE kind='piece') AS pieces,
        coalesce(array_agg(DISTINCT box) FILTER(WHERE box<>''),ARRAY[]::text[]) AS boxes,
        min(recorded_at) AS first,max(recorded_at) AS last
      FROM vanifs_private.events WHERE journey_id=j.id AND kind IN ('piece','box') AND reversed_by IS NULL
      GROUP BY actor_id
    ) p),'[]'::jsonb),
    'presence',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',d.user_id,'deviceId',d.device_id,'name',u.name,'device',d.label,'seenAt',
      floor(extract(epoch FROM d.seen_at)*1000),'pending',d.pending,'box',d.box))
      FROM vanifs_private.devices d JOIN vanifs_private.operators u ON u.user_id=d.user_id
      JOIN vanifs_private.participants p ON p.journey_id=d.journey_id AND p.user_id=d.user_id
      WHERE d.journey_id=j.id AND u.active AND NOT p.revoked
        AND (d.pending>0 OR d.seen_at>statement_timestamp()-interval '45 seconds')),'[]'::jsonb),
    'leases',coalesce((SELECT jsonb_agg(jsonb_build_object('box',l.box,'userId',l.user_id,'name',u.name))
      FROM vanifs_private.leases l JOIN vanifs_private.operators u ON u.user_id=l.user_id
      WHERE l.journey_id=j.id AND l.expires_at>statement_timestamp() AND u.active),'[]'::jsonb),
    'latest',(SELECT jsonb_build_object('at',e.recorded_at,'userId',e.actor_id,'name',e.actor_name,'code',e.body->>'code')
      FROM vanifs_private.events e WHERE e.journey_id=j.id AND e.kind='piece' AND e.reversed_by IS NULL ORDER BY e.seq DESC LIMIT 1))
$$;

CREATE FUNCTION vanifs_private.save_lines(p_id uuid, p_rows jsonb)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 12000
      OR octet_length(p_rows::text)>7340032 THEN
    RAISE EXCEPTION 'El manifiesto debe tener entre 1 y 12,000 líneas válidas.' USING ERRCODE='22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rows) AS x(r)
    WHERE jsonb_typeof(r)<>'object'
      OR coalesce(r->>'qty','') !~ '^[1-9][0-9]{0,5}$'
      OR (r->>'qty')::numeric>100000
      OR (btrim(coalesce(r->>'sku',''))='' AND btrim(coalesce(r->>'upc',''))='')
      OR EXISTS (SELECT 1 FROM unnest(ARRAY['floor','date','section','manifest','box','description','sku','price','supplier','upc','brand']) AS keys(k)
        WHERE jsonb_typeof(r->k) IS DISTINCT FROM 'string'
          OR length(r->>k)>CASE WHEN k='description' THEN 500 WHEN k IN ('manifest','box','sku','upc') THEN 90 ELSE 140 END
          OR (k IN ('manifest','box','sku','upc') AND r->>k ~ '[[:cntrl:]]'))
      OR r - ARRAY['floor','date','section','manifest','box','description','sku','qty','price','supplier','upc','brand'] <> '{}'::jsonb
  ) THEN RAISE EXCEPTION 'Revisa SKU, UPC, cantidades y contenedores del manifiesto.' USING ERRCODE='22023'; END IF;
  INSERT INTO vanifs_private.lines(journey_id,line_no,row_data,sku,upc,box,expected)
  SELECT p_id,n-1,r,upper(btrim(r->>'sku')),upper(btrim(r->>'upc')),upper(btrim(r->>'box')),(r->>'qty')::integer
  FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS x(r,n);
  UPDATE vanifs_private.journeys j SET (expected,line_count,box_count,manifest_count)=(
    SELECT sum(l.expected),count(*),count(DISTINCT nullif(l.box,'')),count(DISTINCT nullif(upper(btrim(l.row_data->>'manifest')),''))
    FROM vanifs_private.lines l WHERE l.journey_id=p_id
  ) WHERE j.id=p_id;
END
$$;

CREATE FUNCTION vanifs_private.operation(e vanifs_private.events)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT e.body || jsonb_build_object('actor',jsonb_build_object('id',e.actor_id,'name',e.actor_name),
    'recordedAt',e.recorded_at,'device',e.device,'deviceId',e.device_id,'scanResult',e.result,'registeredSku',e.sku,'authorizedUndo',e.kind='undo')
$$;

CREATE FUNCTION vanifs_private.snapshot(j vanifs_private.journeys, a vanifs_private.operators, p_after bigint, p_until bigint)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT jsonb_build_object(
    'receipt',vanifs_private.receipt(j),'live',CASE WHEN p_until IS NULL THEN vanifs_private.live(j) ELSE NULL END,
    'viewerRole',a.role,
    'batches',coalesce((SELECT jsonb_agg(jsonb_build_object('seq',q.seq,'ops',jsonb_build_array(vanifs_private.operation(q))) ORDER BY q.seq)
      FROM (
        SELECT e.* FROM vanifs_private.events e WHERE e.journey_id=j.id AND e.seq>p_after AND e.seq<=coalesce(p_until,j.revision)
          AND (a.role<>'collaborator' OR e.actor_id=a.user_id::text)
        ORDER BY e.seq LIMIT 250
      ) q),'[]'::jsonb))
$$;

CREATE FUNCTION vanifs_private.classify_piece(p_id uuid, p_code text, p_box text)
RETURNS TABLE(result text,line_no integer,sku text)
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE hit vanifs_private.lines;
BEGIN
  SELECT l.* INTO hit FROM vanifs_private.lines l
  WHERE l.journey_id=p_id AND l.box=p_box AND (l.sku=p_code OR l.upc=p_code)
  ORDER BY (l.received<l.expected) DESC,
    CASE WHEN l.received<l.expected THEN l.line_no ELSE -l.line_no END LIMIT 1;
  IF FOUND THEN
    line_no:=hit.line_no; sku:=coalesce(nullif(hit.sku,''),p_code);
    IF hit.received<hit.expected THEN
      UPDATE vanifs_private.lines l SET received=received+1 WHERE l.journey_id=p_id AND l.line_no=hit.line_no;
      result:='Recibida';
    ELSE result:='Sobrante';
    END IF;
  ELSE
    sku:=p_code;
    result:=CASE WHEN EXISTS(SELECT 1 FROM vanifs_private.lines l WHERE l.journey_id=p_id AND (l.sku=p_code OR l.upc=p_code))
      THEN 'Otra caja' ELSE 'Fuera de manifiesto' END;
  END IF;
  RETURN NEXT;
END
$$;

CREATE FUNCTION vanifs_private.recount(p_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE e vanifs_private.events; piece record;
BEGIN
  UPDATE vanifs_private.lines SET received=0 WHERE journey_id=p_id AND received<>0;
  FOR e IN SELECT * FROM vanifs_private.events WHERE journey_id=p_id AND kind='piece' AND reversed_by IS NULL ORDER BY seq LOOP
    SELECT * INTO piece FROM vanifs_private.classify_piece(p_id,upper(btrim(e.body->>'code')),e.box);
    UPDATE vanifs_private.events SET result=piece.result,line_no=piece.line_no,sku=piece.sku WHERE id=e.id
      AND (result,line_no,sku) IS DISTINCT FROM (piece.result,piece.line_no,piece.sku);
  END LOOP;
END
$$;

CREATE FUNCTION vanifs_private.record_device(p_id uuid,a vanifs_private.operators,p_device jsonb,p_pending integer,p_box text)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF length(coalesce(p_device->>'label','')) NOT BETWEEN 1 AND 50 OR p_device->>'id' IS NULL
      OR p_pending NOT BETWEEN 0 AND 100000 THEN
    RAISE EXCEPTION 'Dispositivo o número de pendientes inválido.' USING ERRCODE='22023';
  END IF;
  INSERT INTO vanifs_private.participants(journey_id,user_id) VALUES(p_id,a.user_id) ON CONFLICT DO NOTHING;
  INSERT INTO vanifs_private.devices(journey_id,user_id,device_id,label,pending,box)
  VALUES(p_id,a.user_id,(p_device->>'id')::uuid,p_device->>'label',p_pending,p_box)
  ON CONFLICT(journey_id,user_id,device_id) DO UPDATE SET label=excluded.label,pending=excluded.pending,
    box=excluded.box,seen_at=clock_timestamp();
END
$$;

CREATE FUNCTION vanifs_private.append_events(j vanifs_private.journeys,a vanifs_private.operators,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
  op jsonb; e vanifs_private.events; op_id uuid; target_id uuid; op_kind text; next_seq bigint:=j.revision;
  code text; box_key text; label text; line integer; sku text; outcome text; stamp timestamptz;
  device uuid; capture_device uuid; prior_status text; other_box text; piece record;
  acks jsonb:='[]'; operations jsonb:=p_data->'ops';
BEGIN
  IF jsonb_typeof(operations) IS DISTINCT FROM 'array' OR jsonb_array_length(operations) NOT BETWEEN 1 AND 100
      OR octet_length(operations::text)>180000 THEN
    RAISE EXCEPTION 'Envía entre 1 y 100 lecturas por lote.' USING ERRCODE='22023';
  END IF;
  device:=(p_data#>>'{device,id}')::uuid;
  label:=p_data#>>'{device,label}';
  IF device IS NULL OR length(coalesce(label,'')) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Dispositivo inválido.' USING ERRCODE='22023';
  END IF;
  FOR op IN SELECT value FROM jsonb_array_elements(operations) LOOP
    op_id:=(op->>'id')::uuid;
    op_kind:=op->>'kind';
    stamp:=clock_timestamp();
    IF op_id IS NULL OR op_kind IS NULL OR op_kind NOT IN ('box','piece','issue','undo','verify')
      OR op->>'at' IS NULL OR NOT isfinite((op->>'at')::timestamptz)
      OR op - ARRAY['id','kind','at','code','box','source','target','type','note','qty','line','status','captureDevice'] <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Lectura inválida.' USING ERRCODE='22023';
    END IF;
    capture_device:=coalesce((op->>'captureDevice')::uuid,device);
    SELECT * INTO e FROM vanifs_private.events WHERE id=op_id;
    IF FOUND THEN
      IF e.journey_id<>j.id OR e.actor_id<>a.user_id::text OR e.body<>op THEN
        RAISE EXCEPTION 'El identificador de lectura ya tiene otros datos.' USING ERRCODE='PT409';
      END IF;
      acks:=acks || jsonb_build_array(jsonb_build_object('id',e.id,'at',e.recorded_at,'result',e.acknowledged_result,'sku',e.acknowledged_sku));
      CONTINUE;
    END IF;
    IF j.archived OR j.canceled OR (op_kind='verify') IS DISTINCT FROM (j.closed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'La jornada cambió de estado. Conserva las lecturas para supervisión.' USING ERRCODE='PT409';
    END IF;
    IF j.paused_at IS NOT NULL AND op_kind<>'verify' AND (op->>'at')::timestamptz>j.paused_at THEN
      RAISE EXCEPTION 'Jornada pausada. Las lecturas quedan pendientes de supervisión.' USING ERRCODE='PT409';
    END IF;
    code:=upper(btrim(coalesce(op->>'code','')));
    box_key:=upper(btrim(coalesce(op->>'box','')));
    IF length(code)>90 OR length(box_key)>90 OR (code||box_key) ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'Código o contenedor inválido.' USING ERRCODE='22023';
    END IF;
    line:=NULL; sku:=NULL; outcome:='Registrada';
    IF op_kind IN ('box','piece') THEN
      IF code='' OR coalesce(op->>'source','') NOT IN ('Lector','Cámara','Manual')
        OR (op_kind='piece' AND box_key<>'' AND NOT EXISTS(
          SELECT 1 FROM vanifs_private.events b WHERE b.journey_id=j.id AND b.kind='box'
            AND b.box=box_key AND b.actor_id=a.user_id::text AND b.device_id=capture_device
        )) THEN
        RAISE EXCEPTION 'Lectura o contenedor inválido.' USING ERRCODE='22023';
      END IF;
      IF box_key<>'' THEN
        SELECT o.name INTO other_box FROM vanifs_private.leases l JOIN vanifs_private.operators o ON o.user_id=l.user_id
        WHERE l.journey_id=j.id AND l.box=box_key AND l.user_id<>a.user_id AND o.active AND l.expires_at>stamp;
        IF FOUND THEN RAISE EXCEPTION 'Contenedor asignado a %. Conserva las lecturas pendientes.',other_box USING ERRCODE='PT409'; END IF;
        INSERT INTO vanifs_private.leases(journey_id,box,user_id,expires_at) VALUES(j.id,box_key,a.user_id,stamp+interval '55 seconds')
        ON CONFLICT(journey_id,box) DO UPDATE SET user_id=excluded.user_id,expires_at=excluded.expires_at;
      END IF;
      IF op_kind='box' THEN
        IF box_key<>code THEN RAISE EXCEPTION 'El código de caja no coincide.' USING ERRCODE='22023'; END IF;
        outcome:='Caja activa'; sku:=box_key;
      ELSE
        IF box_key='' AND j.box_count>0
          AND NOT EXISTS(SELECT 1 FROM vanifs_private.lines l WHERE l.journey_id=j.id AND l.box='' AND (l.sku=code OR l.upc=code))
          AND (EXISTS(SELECT 1 FROM vanifs_private.lines l WHERE l.journey_id=j.id AND (l.sku=code OR l.upc=code))
            OR NOT EXISTS(SELECT 1 FROM vanifs_private.lines l WHERE l.journey_id=j.id AND l.box='')) THEN
          RAISE EXCEPTION 'Escanea o selecciona primero el contenedor.' USING ERRCODE='22023';
        END IF;
        IF (SELECT count(DISTINCT (l.sku,l.upc)) FROM vanifs_private.lines l
            WHERE l.journey_id=j.id AND l.box=box_key AND (l.sku=code OR l.upc=code))>1 THEN
          RAISE EXCEPTION 'Usa el UPC para distinguir los artículos de la caja.' USING ERRCODE='22023';
        END IF;
        SELECT * INTO piece FROM vanifs_private.classify_piece(j.id,code,box_key);
        outcome:=piece.result; line:=piece.line_no; sku:=piece.sku;
      END IF;
    ELSIF op_kind='issue' THEN
      IF coalesce(op->>'type','') NOT IN ('Daño','Etiqueta ilegible','Pendiente de proveedor','Distribución incorrecta','Otro')
        OR length(btrim(coalesce(op->>'note',''))) NOT BETWEEN 1 AND 500
        OR coalesce(op->>'qty','') !~ '^[1-9][0-9]{0,5}$' OR (op->>'qty')::numeric>100000 THEN
        RAISE EXCEPTION 'Describe la incidencia y sus piezas.' USING ERRCODE='22023';
      END IF;
    ELSIF op_kind='undo' THEN
      target_id:=(op->>'target')::uuid;
      IF NOT EXISTS(SELECT 1 FROM vanifs_private.events WHERE journey_id=j.id AND id=target_id AND kind='piece'
        AND reversed_by IS NULL AND (actor_id=a.user_id::text OR a.role IN ('admin','supervisor'))) THEN
        RAISE EXCEPTION 'La lectura ya fue anulada o pertenece a otro operador.' USING ERRCODE='PT409';
      END IF;
    ELSE
      line:=(op->>'line')::integer;
      IF a.role='collaborator' OR NOT EXISTS(SELECT 1 FROM vanifs_private.lines WHERE journey_id=j.id AND line_no=line AND received<expected)
        OR length(coalesce(op->>'note',''))>500 THEN
        RAISE EXCEPTION 'Verifica los faltantes con supervisión.' USING ERRCODE='42501';
      END IF;
      SELECT body->>'status' INTO prior_status FROM vanifs_private.events WHERE journey_id=j.id AND kind='verify' AND line_no=line ORDER BY seq DESC LIMIT 1;
      IF coalesce(op->>'status','') IS DISTINCT FROM (CASE prior_status
        WHEN 'Confirmado' THEN 'Reportado a SEPRO' WHEN 'Reportado a SEPRO' THEN 'Resuelto'
        WHEN 'Resuelto' THEN NULL ELSE 'Confirmado' END) THEN
        RAISE EXCEPTION 'El faltante ya cambió de estado.' USING ERRCODE='PT409';
      END IF;
    END IF;
    next_seq:=next_seq+1;
    INSERT INTO vanifs_private.events(id,journey_id,seq,body,kind,actor_id,actor_name,device_id,device,recorded_at,box,result,acknowledged_result,acknowledged_sku,line_no,sku)
    VALUES(op_id,j.id,next_seq,op,op_kind,a.user_id::text,a.name,capture_device,label,stamp,box_key,outcome,outcome,sku,line,sku);
    IF op_kind='undo' THEN
      UPDATE vanifs_private.events SET reversed_by=op_id WHERE id=target_id;
      PERFORM vanifs_private.recount(j.id);
    END IF;
    acks:=acks || jsonb_build_array(jsonb_build_object('id',op_id,'at',stamp,'result',outcome,'sku',sku));
  END LOOP;
  PERFORM vanifs_private.record_device(j.id,a,p_data->'device',coalesce((p_data->>'remaining')::integer,0),coalesce(box_key,''));
  IF next_seq<>j.revision THEN
    UPDATE vanifs_private.journeys SET revision=next_seq,updated_at=clock_timestamp() WHERE id=j.id RETURNING * INTO j;
    PERFORM vanifs_private.touch(j.id);
  END IF;
  RETURN vanifs_private.snapshot(j,a,coalesce((p_data->>'after')::bigint,0),j.revision) || jsonb_build_object('acks',acks);
END
$$;

CREATE FUNCTION vanifs_private.transfer(j vanifs_private.journeys,a vanifs_private.operators,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
  code text:=upper(btrim(coalesce(p_data->>'sku','')));
  dept uuid:=(p_data->>'department')::uuid; box text:=btrim(coalesce(p_data->>'marbete',''));
  n integer; product uuid; matches integer; movement uuid:=gen_random_uuid(); result jsonb; prior vanifs_private.transfers;
  inventory_role text;
BEGIN
  IF a.role='collaborator' OR NOT (a.role='admin' OR a.can_close) THEN
    RAISE EXCEPTION 'Se requiere autorización de supervisión.' USING ERRCODE='42501';
  END IF;
  IF j.closed_at IS NULL OR j.archived OR j.canceled OR dept IS NULL OR code='' OR box='' THEN
    RAISE EXCEPTION 'Cierra la jornada y selecciona un SKU conciliado, departamento y marbete.' USING ERRCODE='22023';
  END IF;
  IF to_regprocedure('public.mover_stock_v2(text,uuid,uuid,text,integer,text,text)') IS NULL
    OR to_regprocedure('vantis_core.role_for(uuid)') IS NULL THEN
    RAISE EXCEPTION 'El servidor de inventario aún no tiene habilitado el traspaso.' USING ERRCODE='PT409';
  END IF;
  EXECUTE 'SELECT vantis_core.role_for($1)' INTO inventory_role USING dept;
  IF inventory_role IS NULL THEN RAISE EXCEPTION 'Sin permiso en el departamento de destino.' USING ERRCODE='42501'; END IF;
  SELECT * INTO prior FROM vanifs_private.transfers WHERE journey_id=j.id AND sku=code;
  IF FOUND THEN
    IF prior.department_id<>dept OR prior.marbete<>box THEN RAISE EXCEPTION 'El SKU ya se traspasó a otro marbete.' USING ERRCODE='PT409'; END IF;
    RETURN jsonb_build_object('id',prior.movement_id,'quantity',prior.qty,'replay',true);
  END IF;
  SELECT sum(received) INTO n FROM vanifs_private.lines WHERE journey_id=j.id AND coalesce(nullif(sku,''),upc)=code;
  IF coalesce(n,0)<=0 THEN RAISE EXCEPTION 'El SKU no tiene piezas conciliadas.' USING ERRCODE='22023'; END IF;
  SELECT count(*),min(id::text)::uuid INTO matches,product FROM public.productos
  WHERE departamento_id=dept AND activo AND upper(sku)=code;
  IF matches=0 THEN
    SELECT count(*),min(id::text)::uuid INTO matches,product FROM public.productos
    WHERE departamento_id=dept AND activo AND upper(upc)=code;
  END IF;
  IF matches<>1 THEN RAISE EXCEPTION 'El catálogo del destino debe tener un artículo inequívoco para ese SKU o UPC.' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.marbetes WHERE codigo=box AND departamento_id=dept AND activo) THEN
    RAISE EXCEPTION 'Selecciona un marbete activo de ese departamento.' USING ERRCODE='22023';
  END IF;
  EXECUTE 'SELECT public.mover_stock_v2(NULL,$1,$2,''ENTRADA'',$3,$4,$5)' INTO result
    USING movement,product,n,box,'VANIFS · ' || j.id::text || ' · ' || a.name;
  IF result->>'id' IS DISTINCT FROM movement::text OR NOT EXISTS (
    SELECT 1 FROM public.movimientos WHERE id=movement AND user_id=a.user_id AND cantidad=n
      AND marbete_codigo=box AND departamento_id=dept AND tipo='ENTRADA'
  ) THEN RAISE EXCEPTION 'Inventario no confirmó el movimiento. Traspaso revertido.' USING ERRCODE='PT409'; END IF;
  INSERT INTO vanifs_private.transfers(journey_id,sku,movement_id,department_id,marbete,qty,actor_id)
  VALUES(j.id,code,movement,dept,box,n,a.user_id);
  PERFORM vanifs_private.log(j.id,a,'Traspasó a inventario',code || ' · ' || n || ' pzas · ' || box,'');
  PERFORM vanifs_private.touch(j.id);
  RETURN jsonb_build_object('id',movement,'quantity',n);
END
$$;

CREATE FUNCTION vanifs_private.access_action(a vanifs_private.operators,p_action text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
  user_record auth.users; invite vanifs_private.invites; j vanifs_private.journeys;
  code text; display text; inventory_role text;
BEGIN
  IF p_action='profile' THEN
    IF a.user_id IS NULL THEN RETURN 'null'::jsonb; END IF;
    IF a.employee_number IS NOT NULL AND to_regprocedure('vantis_core.role_for(uuid)') IS NOT NULL THEN
      EXECUTE 'SELECT vantis_core.role_for(NULL::uuid)' INTO inventory_role;
    END IF;
    RETURN jsonb_build_object('id',a.user_id,'name',a.name,'email',(SELECT email FROM auth.users WHERE id=a.user_id),
      'role',a.role,'canClose',a.role='admin' OR (a.role='supervisor' AND a.can_close),
      'platformOwner',a.owner,'inventoryRole',inventory_role,'employeeNumber',a.employee_number);
  END IF;
  IF p_action<>'join' THEN RAISE EXCEPTION 'Operación de acceso inválida.' USING ERRCODE='22023'; END IF;
  SELECT * INTO user_record FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL;
  code:=lower(btrim(coalesce(p_data->>'code','')));
  display:=btrim(coalesce(p_data->>'name',''));
  IF user_record.id IS NULL OR code !~ '^[a-f0-9]{64}$' OR length(display) NOT BETWEEN 1 AND 140 THEN
    RAISE EXCEPTION 'Abre la invitación con tu cuenta individual verificada.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO invite FROM vanifs_private.invites WHERE fingerprint=sha256(convert_to(code,'UTF8'))
    AND email=lower(user_record.email) FOR UPDATE;
  IF NOT FOUND OR (invite.accepted_by IS NULL AND invite.expires_at<=clock_timestamp())
    OR (invite.accepted_by IS NOT NULL AND invite.accepted_by<>user_record.id) THEN
    RAISE EXCEPTION 'La invitación no corresponde a esta cuenta o ya expiró.' USING ERRCODE='42501';
  END IF;
  IF invite.accepted_by=user_record.id THEN RETURN jsonb_build_object('receiptId',invite.journey_id); END IF;
  SELECT * INTO j FROM vanifs_private.journeys WHERE id=invite.journey_id FOR UPDATE;
  IF j.closed_at IS NOT NULL OR j.archived
    OR EXISTS(SELECT 1 FROM vanifs_private.operators WHERE user_id=user_record.id AND NOT active) THEN
    RAISE EXCEPTION 'La jornada ya terminó o el acceso está desactivado.' USING ERRCODE='PT409';
  END IF;
  INSERT INTO vanifs_private.operators(user_id,name,role,can_close)
  VALUES(user_record.id,display,invite.role,invite.can_close) ON CONFLICT(user_id) DO NOTHING;
  INSERT INTO vanifs_private.participants(journey_id,user_id) VALUES(j.id,user_record.id)
  ON CONFLICT(journey_id,user_id) DO UPDATE SET revoked=false;
  UPDATE vanifs_private.invites SET accepted_by=user_record.id,accepted_at=clock_timestamp() WHERE fingerprint=invite.fingerprint;
  PERFORM vanifs_private.log(j.id,vanifs_private.account(),'Aceptó invitación','','');
  PERFORM vanifs_private.touch(j.id);
  RETURN jsonb_build_object('receiptId',j.id);
END
$$;

CREATE FUNCTION vanifs_private.team_action(j vanifs_private.journeys,a vanifs_private.operators,p_action text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
  target vanifs_private.operators; target_id uuid; code text; email_address text; next_role text;
  expires timestamptz; label text:=coalesce(p_data#>>'{device,label}',''); box_key text;
BEGIN
  IF p_action='pulse' THEN
    IF j.closed_at IS NOT NULL OR j.archived THEN RETURN jsonb_build_object('ok',true); END IF;
    box_key:=upper(btrim(coalesce(p_data->>'box','')));
    PERFORM vanifs_private.record_device(j.id,a,p_data->'device',(p_data->>'pending')::integer,box_key);
    UPDATE vanifs_private.leases SET expires_at=clock_timestamp()+interval '55 seconds'
      WHERE journey_id=j.id AND box=box_key AND user_id=a.user_id AND j.paused_at IS NULL;
    RETURN jsonb_build_object('ok',true);
  END IF;
  IF a.role='collaborator' THEN RAISE EXCEPTION 'Se requiere supervisión.' USING ERRCODE='42501'; END IF;
  IF p_action='audit' THEN
    RETURN jsonb_build_object('activities',coalesce((
      SELECT jsonb_agg(jsonb_build_object('id',l.id,'at',l.at,'userId',l.actor_id,'name',l.actor_name,
        'action',l.action,'detail',l.detail,'device',l.device) ORDER BY l.at,l.id)
      FROM vanifs_private.activity l WHERE l.journey_id=j.id
    ),'[]'::jsonb));
  END IF;
  IF p_action='members' THEN
    RETURN jsonb_build_object('members',coalesce((
      SELECT jsonb_agg(jsonb_build_object('id',o.user_id,'name',o.name,'email',u.email,'role',o.role,'canClose',o.can_close)
        ORDER BY o.name) FROM vanifs_private.operators o JOIN auth.users u ON u.id=o.user_id
      LEFT JOIN vanifs_private.participants p ON p.journey_id=j.id AND p.user_id=o.user_id
      WHERE o.active AND NOT coalesce(p.revoked,false)
    ),'[]'::jsonb));
  END IF;
  IF j.closed_at IS NOT NULL OR j.archived THEN RAISE EXCEPTION 'La jornada ya terminó.' USING ERRCODE='PT409'; END IF;
  IF p_action='invite' THEN
    next_role:=coalesce(p_data->>'role','');
    email_address:=lower(btrim(coalesce(p_data->>'email','')));
    IF a.role<>'admin' OR (next_role='admin' AND NOT a.owner) THEN
      RAISE EXCEPTION 'Solo administración puede invitar ese rol.' USING ERRCODE='42501';
    END IF;
    IF next_role NOT IN ('admin','supervisor','collaborator') OR length(email_address)>254
        OR email_address !~ '^[^@]+@(gmail\.com|liverpool\.com\.mx)$' THEN
      RAISE EXCEPTION 'Usa un correo Gmail o Liverpool autorizado.' USING ERRCODE='22023';
    END IF;
    code:=replace(gen_random_uuid()::text || gen_random_uuid()::text,'-','');
    expires:=clock_timestamp()+interval '24 hours';
    INSERT INTO vanifs_private.invites(fingerprint,email,role,can_close,journey_id,issued_by,expires_at)
    VALUES(sha256(convert_to(code,'UTF8')),email_address,next_role,
      next_role='admin' OR (next_role='supervisor' AND coalesce((p_data->>'canClose')::boolean,false)),j.id,a.user_id,expires);
    PERFORM vanifs_private.log(j.id,a,'Creó invitación',email_address || ' · ' || next_role,left(label,50));
    RETURN jsonb_build_object('code',code,'expiresAt',expires);
  END IF;
  IF p_action IN ('role','remove') THEN
    target_id:=(p_data->>'userId')::uuid;
    SELECT * INTO target FROM vanifs_private.operators WHERE user_id=target_id AND active;
    IF a.role<>'admin' OR target.user_id IS NULL OR target.user_id=a.user_id OR target.owner
      OR (target.role='admin' AND NOT a.owner) THEN
      RAISE EXCEPTION 'No puedes cambiar ese acceso.' USING ERRCODE='42501';
    END IF;
    IF p_action='role' THEN
      next_role:=coalesce(p_data->>'role','');
      IF next_role NOT IN ('admin','supervisor','collaborator') OR (next_role='admin' AND NOT a.owner) THEN
        RAISE EXCEPTION 'Ese rol requiere autorización del propietario.' USING ERRCODE='42501';
      END IF;
      UPDATE vanifs_private.operators SET role=next_role,
        can_close=next_role='admin' OR (next_role='supervisor' AND coalesce((p_data->>'canClose')::boolean,false))
      WHERE user_id=target_id;
      PERFORM vanifs_private.log(j.id,a,'Cambió permisos',target.name || ' · ' || next_role,left(label,50));
    ELSE
      IF EXISTS(SELECT 1 FROM vanifs_private.devices WHERE journey_id=j.id AND user_id=target_id AND pending>0) THEN
        RAISE EXCEPTION 'El colaborador tiene lecturas pendientes.' USING ERRCODE='PT409';
      END IF;
      INSERT INTO vanifs_private.participants(journey_id,user_id,revoked) VALUES(j.id,target_id,true)
      ON CONFLICT(journey_id,user_id) DO UPDATE SET revoked=true;
      DELETE FROM vanifs_private.leases WHERE journey_id=j.id AND user_id=target_id;
      DELETE FROM vanifs_private.invites i WHERE i.journey_id=j.id AND i.accepted_by IS NULL
        AND i.email=(SELECT lower(email) FROM auth.users WHERE id=target_id);
      PERFORM vanifs_private.log(j.id,a,'Retiró acceso',target.name,left(label,50));
    END IF;
  ELSIF p_action IN ('pause','assign') THEN
    IF NOT (a.role='admin' OR a.can_close) THEN RAISE EXCEPTION 'Se requiere permiso de cierre.' USING ERRCODE='42501'; END IF;
    IF p_action='pause' THEN
      UPDATE vanifs_private.journeys SET paused_at=CASE WHEN (p_data->>'paused')::boolean THEN coalesce(paused_at,clock_timestamp()) END,
        updated_at=clock_timestamp() WHERE id=j.id;
      PERFORM vanifs_private.log(j.id,a,CASE WHEN (p_data->>'paused')::boolean THEN 'Pausó la jornada' ELSE 'Reanudó la jornada' END,'',left(label,50));
    ELSE
      box_key:=upper(btrim(coalesce(p_data->>'box','')));
      target_id:=(p_data->>'userId')::uuid;
      IF box_key='' OR NOT EXISTS(SELECT 1 FROM vanifs_private.lines WHERE journey_id=j.id AND box=box_key) THEN
        RAISE EXCEPTION 'Selecciona una caja del manifiesto.' USING ERRCODE='22023';
      END IF;
      IF target_id IS NULL THEN
        DELETE FROM vanifs_private.leases WHERE journey_id=j.id AND box=box_key;
        PERFORM vanifs_private.log(j.id,a,'Liberó contenedor',box_key,left(label,50));
      ELSE
        SELECT * INTO target FROM vanifs_private.operators o WHERE o.user_id=target_id AND o.active
          AND NOT EXISTS(SELECT 1 FROM vanifs_private.participants p WHERE p.journey_id=j.id AND p.user_id=target_id AND p.revoked);
        IF NOT FOUND THEN RAISE EXCEPTION 'Ese usuario no tiene acceso a la jornada.' USING ERRCODE='42501'; END IF;
        INSERT INTO vanifs_private.leases(journey_id,box,user_id,expires_at)
        VALUES(j.id,box_key,target_id,clock_timestamp()+interval '55 seconds')
        ON CONFLICT(journey_id,box) DO UPDATE SET user_id=excluded.user_id,expires_at=excluded.expires_at;
        PERFORM vanifs_private.log(j.id,a,'Reasignó contenedor',box_key || ' · ' || target.name,left(label,50));
      END IF;
    END IF;
  ELSE RAISE EXCEPTION 'Acción de equipo inválida.' USING ERRCODE='22023';
  END IF;
  PERFORM vanifs_private.touch(j.id);
  RETURN jsonb_build_object('ok',true);
END
$$;

CREATE FUNCTION vanifs_private.create_journey(a vanifs_private.operators,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
  j vanifs_private.journeys;
  new_id uuid:=(p_data->>'id')::uuid;
  p_title text:=btrim(coalesce(p_data->>'title',''));
  p_file text:=btrim(coalesce(p_data->>'file',''));
  today date:=(clock_timestamp() AT TIME ZONE 'America/Mexico_City')::date;
  fingerprint_text text;
BEGIN
  IF a.role='collaborator' THEN RAISE EXCEPTION 'Solo administración y supervisión publican manifiestos.' USING ERRCODE='42501'; END IF;
  IF new_id IS NULL OR length(p_title) NOT BETWEEN 1 AND 140 OR length(p_file)>140
    OR jsonb_typeof(p_data->'rows') IS DISTINCT FROM 'array' OR octet_length((p_data->'rows')::text)>7340032 THEN
    RAISE EXCEPTION 'Nombre, archivo o filas del manifiesto inválidos.' USING ERRCODE='22023';
  END IF;
  -- Ignore order and presentation fields when checking for a repeat import.
  SELECT encode(sha256(convert_to(string_agg(key,E'\n' ORDER BY key),'UTF8')),'hex') INTO fingerprint_text
  FROM (
    SELECT jsonb_build_array(upper(btrim(r->>'manifest')),upper(btrim(r->>'box')),
      upper(btrim(r->>'sku')),upper(btrim(r->>'upc')),r->>'qty')::text AS key
    FROM jsonb_array_elements(p_data->'rows') AS x(r)
  ) q;
  INSERT INTO vanifs_private.journeys(id,work_date,title,file,fingerprint,created_by)
  VALUES(new_id,today,p_title,p_file,fingerprint_text,a.name)
  ON CONFLICT DO NOTHING RETURNING * INTO j;
  IF NOT FOUND THEN
    SELECT * INTO j FROM vanifs_private.journeys WHERE id=new_id OR (work_date=today AND fingerprint=fingerprint_text)
    ORDER BY (id=new_id) DESC LIMIT 1;
    IF j.fingerprint IS DISTINCT FROM fingerprint_text OR j.archived THEN
      RAISE EXCEPTION 'Ese identificador ya corresponde a otro manifiesto.' USING ERRCODE='PT409';
    END IF;
    RETURN jsonb_build_object('receipt',vanifs_private.receipt(j),'existing',true);
  END IF;
  PERFORM vanifs_private.save_lines(j.id,p_data->'rows');
  PERFORM vanifs_private.log(j.id,a,'Publicó manifiesto',p_title,'');
  PERFORM vanifs_private.touch(j.id);
  SELECT * INTO j FROM vanifs_private.journeys WHERE id=new_id;
  RETURN jsonb_build_object('receipt',vanifs_private.receipt(j));
END
$$;

CREATE FUNCTION vanifs_private.finish_journey(j vanifs_private.journeys,a vanifs_private.operators,p_action text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
  note_text text:=btrim(coalesce(p_data->>'note',''));
  final_totals jsonb; canceling boolean:=p_action='cancel';
  closing_device_id uuid:=(p_data#>>'{device,id}')::uuid;
BEGIN
  IF NOT (a.role='admin' OR (a.role='supervisor' AND a.can_close)) OR j.archived THEN
    RAISE EXCEPTION 'Se requiere permiso de supervisión sobre una jornada operativa.' USING ERRCODE='42501';
  END IF;
  IF p_action='reopen' THEN
    IF j.closed_at IS NULL OR j.canceled OR length(note_text) NOT BETWEEN 1 AND 500
      OR EXISTS(SELECT 1 FROM vanifs_private.transfers WHERE journey_id=j.id) THEN
      RAISE EXCEPTION 'Indica el motivo y verifica que la jornada no tenga traspasos.' USING ERRCODE='PT409';
    END IF;
    PERFORM vanifs_private.log(j.id,a,'Reabrió jornada',note_text,left(coalesce(p_data#>>'{device,label}',''),50));
    UPDATE vanifs_private.journeys SET closed_at=NULL,closed_by=NULL,totals=NULL,note='',paused_at=NULL,
      updated_at=clock_timestamp() WHERE id=j.id RETURNING * INTO j;
  ELSE
    IF j.closed_at IS NOT NULL THEN
      IF canceling=j.canceled THEN RETURN jsonb_build_object('receipt',vanifs_private.receipt(j)); END IF;
      RAISE EXCEPTION 'La jornada ya terminó.' USING ERRCODE='PT409';
    END IF;
    IF (p_data->>'revision')::bigint IS DISTINCT FROM j.revision THEN
      RAISE EXCEPTION 'Llegaron nuevas lecturas. Revisa los totales y vuelve a intentar.' USING ERRCODE='PT409';
    END IF;
    IF length(note_text)>500 OR closing_device_id IS NULL THEN RAISE EXCEPTION 'Revisa el motivo y el dispositivo.' USING ERRCODE='22023'; END IF;
    IF EXISTS (
      SELECT 1 FROM vanifs_private.devices d WHERE d.journey_id=j.id AND
        (d.pending>0 OR ((d.user_id,d.device_id)<>(a.user_id,closing_device_id)
          AND d.seen_at>statement_timestamp()-interval '45 seconds' AND (j.paused_at IS NULL OR d.seen_at<j.paused_at)))
    ) THEN RAISE EXCEPTION 'Pausa la jornada y espera a que todos sincronicen antes de cerrar.' USING ERRCODE='PT409'; END IF;
    final_totals:=vanifs_private.totals(j.id);
    IF NOT canceling AND EXISTS(
      SELECT 1 FROM jsonb_each_text(final_totals) WHERE key IN ('missing','extra','unknown','wrongBox','manual') AND value::bigint>0
    ) AND (note_text='' OR NOT coalesce((p_data->>'acknowledged')::boolean,false)) THEN
      RAISE EXCEPTION 'Documenta las diferencias y autoriza el cierre con incidencias.' USING ERRCODE='PT409';
    END IF;
    PERFORM vanifs_private.log(j.id,a,CASE WHEN canceling THEN 'Canceló jornada' ELSE 'Cerró jornada' END,
      note_text,left(coalesce(p_data#>>'{device,label}',''),50));
    UPDATE vanifs_private.journeys SET closed_at=clock_timestamp(),closed_by=a.name,
      note=note_text,totals=final_totals,canceled=canceling,paused_at=NULL,updated_at=clock_timestamp()
    WHERE id=j.id RETURNING * INTO j;
  END IF;
  PERFORM vanifs_private.touch(j.id);
  RETURN jsonb_build_object('receipt',vanifs_private.receipt(j));
END
$$;

CREATE FUNCTION vanifs_private.dispatch(p_route text,p_action text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  a vanifs_private.operators; j vanifs_private.journeys; target_id uuid;
  prior text; prior_at timestamptz; prior_id uuid; cutoff bigint; offset_line integer;
  today date:=(statement_timestamp() AT TIME ZONE 'America/Mexico_City')::date;
BEGIN
  IF auth.uid() IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Inicia sesión con una cuenta individual.' USING ERRCODE='42501';
  END IF;
  a:=vanifs_private.account();
  IF p_route='access' THEN RETURN vanifs_private.access_action(a,p_action,p_data); END IF;
  IF a.user_id IS NULL THEN RAISE EXCEPTION 'Esta cuenta no tiene acceso a VANIFS.' USING ERRCODE='42501'; END IF;
  IF p_route='receipt' AND p_action='create' THEN RETURN vanifs_private.create_journey(a,p_data); END IF;
  IF p_route='receipt' AND p_action IN ('list','today') THEN
    prior:=nullif(p_data->>'before','');
    IF prior IS NOT NULL THEN prior_at:=split_part(prior,'|',1)::timestamptz; prior_id:=split_part(prior,'|',2)::uuid; END IF;
    RETURN (WITH records AS (
      SELECT q.*,row_number() OVER (ORDER BY q.created_at DESC,q.id DESC) AS ix FROM (
        SELECT jn.* FROM vanifs_private.journeys jn
        WHERE vanifs_private.may_read(jn.id)
          AND (p_action='list' OR (jn.work_date=today AND jn.closed_at IS NULL AND NOT jn.archived))
          AND (prior_at IS NULL OR (jn.created_at,jn.id)<(prior_at,prior_id))
          AND (coalesce(p_data->>'q','')='' OR strpos(lower(jn.title),lower(left(p_data->>'q',140)))>0 OR jn.id::text=lower(p_data->>'q')
            OR ((p_data->>'q') ~* '^[a-f0-9]{8}$' AND left(jn.id::text,8)=lower(p_data->>'q')))
        ORDER BY jn.created_at DESC,jn.id DESC LIMIT 51
      ) q
    ) SELECT jsonb_build_object('receipts',coalesce(jsonb_agg(
      vanifs_private.receipt(jn) || CASE WHEN p_action='today' THEN jsonb_build_object('live',vanifs_private.live(jn)) ELSE '{}'::jsonb END
      ORDER BY r.ix) FILTER(WHERE r.ix<=50),'[]'::jsonb),
      'next',CASE WHEN count(*)>50 THEN max(r.created_at::text || '|' || r.id::text) FILTER(WHERE r.ix=50) END)
      FROM records r JOIN vanifs_private.journeys jn ON jn.id=r.id);
  END IF;
  target_id:=(p_data->>'id')::uuid;
  IF p_action IN ('detail','rows','audit','members') THEN
    SELECT * INTO j FROM vanifs_private.journeys WHERE id=target_id;
  ELSE
    SELECT * INTO j FROM vanifs_private.journeys WHERE id=target_id FOR UPDATE;
    a:=vanifs_private.account();
  END IF;
  IF j.id IS NULL OR a.user_id IS NULL OR NOT vanifs_private.may_read(j.id) THEN
    RAISE EXCEPTION 'No se encontró una jornada autorizada.' USING ERRCODE='PT404';
  END IF;
  IF p_route='team' THEN RETURN vanifs_private.team_action(j,a,p_action,p_data); END IF;
  IF p_route<>'receipt' THEN RAISE EXCEPTION 'Ruta de operación inválida.' USING ERRCODE='22023'; END IF;
  IF p_action='detail' THEN
    cutoff:=(p_data->>'through')::bigint;
    RETURN vanifs_private.snapshot(j,a,greatest(0,coalesce((p_data->>'after')::bigint,0)),cutoff);
  ELSIF p_action='rows' THEN
    offset_line:=greatest(0,coalesce((p_data->>'offset')::integer,0));
    RETURN jsonb_build_object('rows',coalesce((SELECT jsonb_agg(s.row_data ORDER BY s.line_no) FROM
      (SELECT l.line_no,l.row_data FROM vanifs_private.lines l WHERE l.journey_id=j.id AND l.line_no>=offset_line ORDER BY l.line_no LIMIT 400) s
    ),'[]'::jsonb));
  ELSIF p_action='append' THEN RETURN vanifs_private.append_events(j,a,p_data);
  ELSIF p_action IN ('close','cancel','reopen') THEN RETURN vanifs_private.finish_journey(j,a,p_action,p_data);
  ELSIF p_action='transfer' THEN RETURN vanifs_private.transfer(j,a,p_data);
  END IF;
  RAISE EXCEPTION 'Operación inválida.' USING ERRCODE='22023';
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA vanifs_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA vanifs_private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vanifs_private.may_read(uuid),vanifs_private.dispatch(text,text,jsonb) TO authenticated;

CREATE FUNCTION public.vanifs_api(p_route text,p_action text,p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT vanifs_private.dispatch(p_route,p_action,p_data)
$$;
REVOKE ALL ON FUNCTION public.vanifs_api(text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vanifs_api(text,text,jsonb) TO authenticated;

-- Run by the database owner on a private, verified export. Never reachable via vanifs_api.
CREATE FUNCTION vanifs_private.import_d1_archive(p_export jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
  j jsonb; op jsonb; original_rows jsonb; totals jsonb; j_id uuid; seq bigint; op_id uuid;
  saved_hash bytea:=sha256(convert_to(p_export::text,'UTF8'));
  old_actor text; op_kind text; box_key text; n integer:=0; ops integer:=0; rows_imported integer:=0;
BEGIN
  IF coalesce(p_export->>'format','') NOT IN ('vanifs-d1-v1','vanifs-d1-v2')
    OR jsonb_typeof(p_export->'receipts') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_export->'manifest_blocks') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_export->'operation_batches') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Se requiere el respaldo original de VANIFS.';
  END IF;
  INSERT INTO vanifs_private.legacy_backups(fingerprint,source) VALUES(saved_hash,p_export) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('duplicate',true); END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_export->'receipts') x(r) WHERE r->>'closed_at' IS NULL) THEN
    RAISE EXCEPTION 'Termina y sincroniza las jornadas de origen antes del corte.';
  END IF;
  IF EXISTS(SELECT 1 FROM (
    SELECT value->>'receipt_id' AS receipt_id FROM jsonb_array_elements(p_export->'manifest_blocks')
    UNION SELECT value->>'receipt_id' FROM jsonb_array_elements(p_export->'operation_batches')
  ) x WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_export->'receipts') j(r) WHERE r->>'id'=x.receipt_id)) THEN
    RAISE EXCEPTION 'El respaldo contiene filas o lecturas sin jornada.';
  END IF;
  FOR j IN SELECT value FROM jsonb_array_elements(p_export->'receipts') LOOP
    j_id:=(j->>'id')::uuid;
    totals:=(j->>'totals')::jsonb;
    INSERT INTO vanifs_private.journeys(id,work_date,title,file,created_at,created_by,closed_at,closed_by,note,canceled,archived,totals,updated_at)
    VALUES(j_id,((j->>'created_at')::timestamptz AT TIME ZONE 'America/Mexico_City')::date,j->>'title',j->>'file',
      (j->>'created_at')::timestamptz,j->>'created_by',(j->>'closed_at')::timestamptz,j->>'closed_by',coalesce(j->>'note',''),
      coalesce((totals->>'canceled')::boolean,false),true,totals-'canceled',(j->>'closed_at')::timestamptz);
    SELECT coalesce(jsonb_agg(x.r ORDER BY (b->>'position')::integer,x.n),'[]'::jsonb) INTO original_rows
    FROM jsonb_array_elements(p_export->'manifest_blocks') y(b)
    CROSS JOIN LATERAL jsonb_array_elements((b->>'rows')::jsonb) WITH ORDINALITY x(r,n)
    WHERE b->>'receipt_id'=j_id::text;
    IF jsonb_array_length(original_rows) IS DISTINCT FROM (j->>'line_count')::integer THEN
      RAISE EXCEPTION 'El respaldo no contiene todas las líneas.';
    END IF;
    PERFORM vanifs_private.save_lines(j_id,original_rows);
    IF (SELECT expected FROM vanifs_private.journeys WHERE id=j_id) IS DISTINCT FROM (j->>'expected')::bigint THEN
      RAISE EXCEPTION 'El total manifestado no coincide con el respaldo.';
    END IF;
    seq:=0;
    FOR op IN SELECT x.r FROM jsonb_array_elements(p_export->'operation_batches') y(b)
      CROSS JOIN LATERAL jsonb_array_elements((b->>'ops')::jsonb) WITH ORDINALITY x(r,n)
      WHERE b->>'receipt_id'=j_id::text ORDER BY (b->>'seq')::integer,x.n LOOP
      seq:=seq+1; op_id:=(op->>'id')::uuid; op_kind:=op->>'kind'; old_actor:=coalesce(op#>>'{actor,id}','legacy');
      box_key:=upper(btrim(coalesce(op->>'box','')));
      INSERT INTO vanifs_private.events(id,journey_id,seq,body,kind,actor_id,actor_name,device_id,device,recorded_at,box,result,acknowledged_result,acknowledged_sku,line_no,sku)
      VALUES(op_id,j_id,seq,op-ARRAY['actor','recordedAt','deviceId','device','scanResult','registeredSku'],op_kind,old_actor,
        coalesce(op#>>'{actor,name}','VANIFS'),nullif(op->>'deviceId','legacy')::uuid,coalesce(op->>'device',''),
        coalesce(op->>'recordedAt',op->>'at')::timestamptz,box_key,
        coalesce(op->>'scanResult',CASE WHEN op_kind='box' THEN 'Caja activa' ELSE 'Registrada' END),
        coalesce(op->>'scanResult','Registrada'),op->>'registeredSku',CASE WHEN op_kind='verify' THEN (op->>'line')::integer END,op->>'registeredSku');
      IF op_kind='undo' THEN
        UPDATE vanifs_private.events e SET reversed_by=op_id WHERE e.journey_id=j_id AND e.id=(op->>'target')::uuid
          AND e.actor_id=old_actor AND e.kind='piece' AND e.reversed_by IS NULL;
      END IF;
    END LOOP;
    PERFORM vanifs_private.recount(j_id);
    UPDATE vanifs_private.journeys SET revision=seq WHERE id=j_id;
    INSERT INTO vanifs_private.activity(id,journey_id,actor_id,actor_name,action,detail,device,at)
      SELECT (x->>'id')::uuid,j_id,x->>'user_id',x->>'name',x->>'action',x->>'detail',x->>'device',(x->>'at')::timestamptz
      FROM jsonb_array_elements(coalesce(p_export->'team_activity','[]'::jsonb)) a(x) WHERE x->>'receipt_id'=j_id::text;
    PERFORM vanifs_private.touch(j_id);
    n:=n+1; ops:=ops+seq; rows_imported:=rows_imported+jsonb_array_length(original_rows);
  END LOOP;
  RETURN jsonb_build_object('journeys',n,'events',ops,'lines',rows_imported);
END
$$;
REVOKE ALL ON FUNCTION vanifs_private.import_d1_archive(jsonb) FROM PUBLIC, anon, authenticated;
