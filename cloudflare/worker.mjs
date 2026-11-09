// VANTIS Equipo · Worker API. No Supabase and no secrets in browser assets.
// Deploy only after configuring D1, ALLOWED_ORIGIN, AUTH_SECRET, VANTIS_SETUP_KEY.
const DEPT='ZAPATERIA INFANTIL';
const now=()=>Date.now();
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{
  status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}
});
const fail=(status,message,code='BAD_REQUEST')=>Object.assign(new Error(message),{status,code});
const clean=value=>String(value??'').trim();
const employeeOk=value=>/^\d{4,12}$/.test(value);
const pinOk=value=>/^\d{6,12}$/.test(value);
const skuOk=value=>/^\d{6,20}$/.test(value);
const idOk=value=>/^[a-zA-Z0-9_-]{12,100}$/.test(value);
const encode=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode=text=>Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((text.length+3)%4)),c=>c.charCodeAt(0));
const normalizeLabel=input=>{
  const raw=clean(input).toUpperCase().replace(/[’'"\s*·_/\\]+/g,'-').replace(/-+/g,'-');
  const match=raw.match(/^(?:ZAP-)?(402|405|459)-(\d{3,4})$/);
  if(!match)throw fail(422,'Marbete inválido: utiliza 402-000, 405-000 o 459-000.','22023');
  return 'ZAP-'+match[1]+'-'+match[2];
};
const sqlError=error=>{
  if(/constraint|foreign key|CHECK/i.test(String(error?.message||'')))return fail(409,'El registro contradice las existencias o ya fue aplicado.','22023');
  return error;
};
async function payload(req,max=16000){
  const declared=Number(req.headers.get('content-length')||0);
  if(declared>max)throw fail(413,'Solicitud demasiado grande.');
  const body=await req.text();
  if(body.length>max)throw fail(413,'Solicitud demasiado grande.');
  try {return JSON.parse(body);}catch{throw fail(400,'JSON inválido.');}
}
function requireSettings(env) {
  if(!env?.DB||!env?.AUTH_SECRET||String(env.AUTH_SECRET).length<32||
    !env?.VANTIS_SETUP_KEY||String(env.VANTIS_SETUP_KEY).length<24||
    !env?.ALLOWED_ORIGIN||!/^https:\/\//.test(env.ALLOWED_ORIGIN))
    throw fail(503,'Servidor de VANTIS sin configurar. No escanees todavía.','NOT_CONFIGURED');
}
async function mac(env,data) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.AUTH_SECRET),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  return encode(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(data)));
}
async function pinHash(env,employee,pin,salt){return mac(env,employee+':'+salt+':'+pin);}
const same=(a,b)=>{
  if(a.length!==b.length)return false;
  let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
};
async function issueSession(env,person) {
  const body=encode(new TextEncoder().encode(JSON.stringify({sub:person.employee,exp:now()+8*60*60*1000})));
  return body+'.'+await mac(env,body);
}
async function identify(req,env){
  const value=req.headers.get('authorization')||'';
  if(!value.startsWith('Bearer '))throw fail(401,'Inicia sesión con tu número de empleado y PIN.','UNAUTHORIZED');
  const token=value.slice(7),parts=token.split('.');
  if(parts.length!==2||parts[0].length>1200||!same(parts[1],await mac(env,parts[0])))
    throw fail(401,'Sesión inválida. Vuelve a ingresar.','UNAUTHORIZED');
  let claims;
  try{claims=JSON.parse(new TextDecoder().decode(decode(parts[0])));}catch{throw fail(401,'Sesión inválida.','UNAUTHORIZED');}
  if(!employeeOk(claims.sub)||!Number.isFinite(claims.exp)||claims.exp<now())
    throw fail(401,'Sesión caducada. Vuelve a ingresar.','UNAUTHORIZED');
  const person=await env.DB.prepare('SELECT employee,name,role,active FROM people WHERE employee=?').bind(claims.sub).first();
  if(!person?.active)throw fail(403,'Acceso deshabilitado.','FORBIDDEN');
  return person;
}
const need=(person,...roles)=>{if(!roles.includes(person.role))throw fail(403,'Tu perfil no permite esta operación.','FORBIDDEN');};
async function bootstrap(env,body){
  if(clean(body.key)!==env.VANTIS_SETUP_KEY)throw fail(403,'Clave de instalación incorrecta.','FORBIDDEN');
  const found=await env.DB.prepare('SELECT count(*) AS c FROM people').first();
  if(found.c)throw fail(409,'La cuenta administradora ya está configurada.','22023');
  const employee=clean(body.employee),pin=clean(body.pin),name=clean(body.name).slice(0,80);
  if(!employeeOk(employee)||!pinOk(pin)||name.length<2)throw fail(422,'Empleado, nombre o PIN inválidos.','22023');
  const salt=crypto.randomUUID(),hash=await pinHash(env,employee,pin,salt);
  await env.DB.prepare('INSERT INTO people(employee,name,role,salt,pin_hash) VALUES(?,?,?,?,?)')
    .bind(employee,name,'admin',salt,hash).run();
  return json({ok:true},201);
}
async function login(env,body){
  const employee=clean(body.employee),pin=clean(body.pin);
  if(!employeeOk(employee)||!pinOk(pin))throw fail(401,'Credenciales incorrectas.','UNAUTHORIZED');
  const attempts=await env.DB.prepare('SELECT failed,locked_until FROM auth_attempts WHERE employee=?').bind(employee).first();
  if(Number(attempts?.locked_until||0)>now())throw fail(429,'Demasiados intentos. Intenta más tarde.','LOCKED');
  const person=await env.DB.prepare('SELECT * FROM people WHERE employee=?').bind(employee).first();
  const candidate=await pinHash(env,employee,pin,person?.salt||'invalid');
  if(!person?.active||!same(person.pin_hash||'',candidate)){
    const failed=(Number(attempts?.failed||0)+1);
    await env.DB.prepare('INSERT INTO auth_attempts(employee,failed,locked_until) VALUES(?,?,?) ON CONFLICT(employee) DO UPDATE SET failed=excluded.failed,locked_until=excluded.locked_until')
      .bind(employee,failed>=5?0:failed,failed>=5?now()+15*60*1000:0).run();
    throw fail(401,'Credenciales incorrectas.','UNAUTHORIZED');
  }
  await env.DB.prepare('DELETE FROM auth_attempts WHERE employee=?').bind(employee).run();
  return json({token:await issueSession(env,person),employee:person.employee,name:person.name,role:person.role});
}
async function activate(env,code){
  const label=normalizeLabel(code);
  await env.DB.prepare("INSERT OR IGNORE INTO labels(code,dept,active) VALUES(?,?,1)").bind(label,DEPT).run();
  const existing=await env.DB.prepare('SELECT code,dept,active FROM labels WHERE code=?').bind(label).first();
  if(!existing?.active||existing.dept!==DEPT)throw fail(403,'Marbete no autorizado.','42501');
  return {codigo:existing.code,departamento_id:DEPT,activo:true};
}
async function ensureProduct(env,raw){
  const code=clean(raw);
  if(!skuOk(code))throw fail(422,'SKU/UPC inválido (6 a 20 dígitos).','22023');
  await env.DB.prepare('INSERT OR IGNORE INTO products(code,description,stock,active,dept) VALUES(?,?,0,1,?)')
    .bind(code,'SKU/UPC '+code,DEPT).run();
  const item=await env.DB.prepare('SELECT code,description,stock,active,dept FROM products WHERE code=?').bind(code).first();
  if(!item?.active||item.dept!==DEPT)throw fail(403,'Artículo no autorizado.','42501');
  return {id:item.code,sku:item.code,upc:null,descripcion:item.description,
    stock:item.stock,activo:true,departamento_id:DEPT};
}
function receiptReply(row){
  return {id:row.id,session_id:row.session_id,user_id:row.employee,product_id:row.sku,
    sku:row.sku,marbete_codigo:row.label,quantity:1,kind:row.kind,
    stock_resultante:row.stock_after,location_quantity:row.location_after,stored_at:row.stored_at};
}
async function saveReceipt(env,person,input,origin=null){
  const id=clean(input.p_id),session=clean(input.p_sesion),sku=clean(input.p_producto);
  const label=normalizeLabel(input.p_marbete),reversal=clean(input.p_reversa)||null;
  if(!idOk(id)||!idOk(session)||!skuOk(sku)||input.p_departamento!==DEPT)
    throw fail(422,'Lectura incompleta o mal formada.','22023');
  const signature=JSON.stringify([session,sku,label,reversal]);
  const prior=await env.DB.prepare('SELECT * FROM receipts WHERE id=?').bind(id).first();
  if(prior){
    if(prior.signature!==signature||prior.employee!==person.employee)
      throw fail(409,'Folio duplicado con contenido diferente.','22023');
    return receiptReply(prior);
  }
  const kind=reversal?'undo':'receive',delta=reversal?-1:1;
  const operator=origin?clean(origin).slice(0,100):(person.name+' · '+person.employee).slice(0,100);
  // Each db.batch is one SQLite transaction, so simultaneous scanners cannot
  // increment the same receipt twice. changes() gates both stock updates.
  const statements=[
    env.DB.prepare(\`INSERT INTO receipts(id,session_id,employee,operator_label,sku,label,kind,reversal_of,signature)
      SELECT ?,?,?,?,?,?,?,?,?
      WHERE EXISTS(SELECT 1 FROM labels WHERE code=? AND active=1 AND dept=?)
        AND EXISTS(SELECT 1 FROM products WHERE code=? AND active=1 AND dept=?)
        AND (?='receive' OR (EXISTS(
          SELECT 1 FROM receipts WHERE id=? AND kind='receive' AND session_id=? AND
            employee=? AND sku=? AND label=?
        ) AND NOT EXISTS(SELECT 1 FROM receipts WHERE reversal_of=?)
          AND (SELECT stock FROM products WHERE code=?)>0
          AND coalesce((SELECT quantity FROM assignments WHERE sku=? AND label=?),0)>0))
      ON CONFLICT DO NOTHING\`)
      .bind(id,session,person.employee,operator,sku,label,kind,reversal,signature,
        label,DEPT,sku,DEPT,kind,reversal,session,person.employee,sku,label,reversal,sku,sku,label),
    env.DB.prepare('UPDATE products SET stock=stock+? WHERE code=? AND changes()>0 AND stock+?>=0')
      .bind(delta,sku,delta),
    env.DB.prepare(\`INSERT INTO assignments(sku,label,quantity)
      SELECT ?,?,? WHERE changes()>0
      ON CONFLICT(sku,label) DO UPDATE SET quantity=assignments.quantity+excluded.quantity\`)
      .bind(sku,label,delta),
    env.DB.prepare(\`UPDATE receipts SET
      stock_after=(SELECT stock FROM products WHERE code=?),
      location_after=(SELECT quantity FROM assignments WHERE sku=? AND label=?)
      WHERE id=? AND stock_after IS NULL\`).bind(sku,sku,label,id)
  ];
  try{await env.DB.batch(statements);}catch(error){throw sqlError(error);}
  const stored=await env.DB.prepare('SELECT * FROM receipts WHERE id=?').bind(id).first();
  if(!stored)throw fail(422,'No se guardó: verifica el marbete, el artículo y la reversa.','22023');
  if(stored.signature!==signature||stored.employee!==person.employee)
    throw fail(409,'Folio repetido; se bloqueó un segundo movimiento.','22023');
  if(!Number.isSafeInteger(stored.stock_after)||!Number.isSafeInteger(stored.location_after))
    throw fail(500,'Movimiento pendiente de conciliación. Conserva el folio.','VANTIS_UNCERTAIN');
  return receiptReply(stored);
}
async function search(env,term){
  const q=clean(term).slice(0,60);
  if(!q)return [];
  const like='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
  const result=await env.DB.prepare(\`SELECT p.code,p.description,p.stock,a.label,a.quantity
    FROM products p LEFT JOIN assignments a ON a.sku=p.code
    WHERE p.code=? OR p.code LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\'
      OR a.label LIKE ? ESCAPE '\\'
    ORDER BY p.code,a.label LIMIT 140\`).bind(q,like,like,like).all();
  const found=new Map();
  for(const row of result.results){
    let value=found.get(row.code);
    if(!value){value={sku:row.code,descripcion:row.description,stock:row.stock,ubicaciones:[]};found.set(row.code,value);}
    if(row.label&&row.quantity>0)value.ubicaciones.push({marbete:row.label,cantidad:row.quantity});
  }
  return [...found.values()];
}
async function summary(env){
  const [p,l,r]=await Promise.all([
    env.DB.prepare('SELECT count(*) AS products,coalesce(sum(stock),0) AS units FROM products').first(),
    env.DB.prepare('SELECT count(*) AS labels FROM labels').first(),
    env.DB.prepare('SELECT count(*) AS receipts FROM receipts').first()
  ]);
  return {products:p.products,labels:l.labels,receipts:r.receipts,units:p.units};
}
async function handler(req,env){
  requireSettings(env);
  const u=new URL(req.url),path=u.pathname,method=req.method.toUpperCase();
  if(path==='/api/health'&&method==='GET')return json({ok:true,mode:'vantis-d1',version:1});
  if(path==='/api/bootstrap'&&method==='POST')return bootstrap(env,await payload(req));
  if(path==='/api/login'&&method==='POST')return login(env,await payload(req));
  const person=await identify(req,env);
  if(path==='/api/me'&&method==='GET')return json({employee:person.employee,name:person.name,role:person.role});
  if(path==='/api/capabilities'&&method==='GET'){need(person,'admin','scanner');return json({version:1,atomic:true,idempotent:true});}
  if(path==='/api/labels'&&method==='POST'){
    need(person,'admin','scanner');return json(await activate(env,(await payload(req)).code));
  }
  if(path==='/api/products'&&method==='POST'){
    need(person,'admin','scanner');return json(await ensureProduct(env,(await payload(req)).code));
  }
  if(path==='/api/catalog'&&method==='GET'){
    const codes=(u.searchParams.get('codes')||'').split(',').filter(Boolean).slice(0,75);
    if(codes.some(c=>!skuOk(c)))throw fail(422,'Consulta de catálogo inválida.','22023');
    if(!codes.length)return json([]);
    const found=await Promise.all(codes.map(code=>env.DB.prepare('SELECT code,description,stock,active,dept FROM products WHERE code=?').bind(code).first()));
    return json(codes.map((code,i)=>({code,product:found[i]?{
      id:found[i].code,sku:found[i].code,upc:null,descripcion:found[i].description,stock:found[i].stock,
      activo:Boolean(found[i].active),departamento_id:found[i].dept}:null})));
  }
  if(path==='/api/receipts'&&method==='POST'){
    need(person,'admin','scanner');return json(await saveReceipt(env,person,await payload(req)));
  }
  if(path==='/api/summary'&&method==='GET')return json(await summary(env));
  if(path==='/api/search'&&method==='GET')return json({items:await search(env,u.searchParams.get('q'))});
  if(path==='/api/history'&&method==='GET'){
    const limit=Math.min(Math.max(Number(u.searchParams.get('limit')||60),1),100);
    const result=await env.DB.prepare('SELECT id,stored_at,employee,operator_label,sku,label,kind,stock_after FROM receipts ORDER BY stored_at DESC,id DESC LIMIT ?')
      .bind(limit).all();
    return json({items:result.results});
  }
  if(path==='/api/people'&&method==='GET'){
    need(person,'admin');const result=await env.DB.prepare('SELECT employee,name,role,active,created_at FROM people ORDER BY employee').all();
    return json({items:result.results});
  }
  if(path==='/api/people'&&method==='POST'){
    need(person,'admin');const b=await payload(req),employee=clean(b.employee),name=clean(b.name).slice(0,80),
      pin=clean(b.pin),role=clean(b.role);
    if(!employeeOk(employee)||!pinOk(pin)||name.length<2||!['admin','scanner','viewer'].includes(role))
      throw fail(422,'Empleado, nombre, PIN o rol inválido.','22023');
    const salt=crypto.randomUUID(),hash=await pinHash(env,employee,pin,salt);
    try{await env.DB.prepare('INSERT INTO people(employee,name,role,salt,pin_hash) VALUES(?,?,?,?,?)')
      .bind(employee,name,role,salt,hash).run();}
    catch(e){throw fail(409,'Ese número de empleado ya está registrado.','22023');}
    return json({ok:true,employee},201);
  }
  if(path==='/api/people'&&method==='PATCH'){
    need(person,'admin');const b=await payload(req),employee=clean(b.employee),active=b.active?1:0;
    if(!employeeOk(employee)||!['admin','scanner','viewer'].includes(b.role)||employee===person.employee)
      throw fail(422,'No puedes cambiar tu propio perfil.','22023');
    const result=await env.DB.prepare('UPDATE people SET role=?,active=? WHERE employee=?').bind(b.role,active,employee).run();
    if(!result.meta.changes)throw fail(404,'Empleado no encontrado.');
    return json({ok:true});
  }
  if(path==='/api/products/describe'&&method==='PATCH'){
    need(person,'admin');const b=await payload(req),code=clean(b.code),description=clean(b.description).slice(0,160);
    if(!skuOk(code)||description.length<3)throw fail(422,'Descripción inválida.','22023');
    const result=await env.DB.prepare('UPDATE products SET description=? WHERE code=?').bind(description,code).run();
    if(!result.meta.changes)throw fail(404,'SKU no encontrado.');
    return json({ok:true});
  }
  if(path==='/api/import'&&method==='POST'){
    need(person,'admin');const b=await payload(req,10000);
    if(!Array.isArray(b.items)||!b.items.length||b.items.length>5)throw fail(422,'Importa entre 1 y 5 movimientos por petición.','22023');
    let imported=0;
    for(const row of b.items){
      const p=row?.payload;
      if(!p||!idOk(clean(p.p_id))||clean(row.receipt?.id)!==clean(p.p_id))
        throw fail(422,'Respaldo mal formado.','22023');
      await activate(env,p.p_marbete);
      await ensureProduct(env,p.p_producto);
      const prev=await env.DB.prepare('SELECT id FROM receipts WHERE id=?').bind(p.p_id).first();
      await saveReceipt(env,person,p,clean(p.p_operador));
      if(!prev)imported++;
    }
    return json({imported,repeated:b.items.length-imported});
  }
  throw fail(404,'Ruta desconocida.','NOT_FOUND');
}
export default {
  async fetch(request,env) {
    const origin=request.headers.get('origin');
    const allowed=env?.ALLOWED_ORIGIN;
    const headers=origin&&origin===allowed?{
      'access-control-allow-origin':origin,
      'access-control-allow-methods':'GET,POST,PATCH,OPTIONS',
      'access-control-allow-headers':'authorization,content-type',
      'access-control-max-age':'600','vary':'Origin'
    }:{};
    if(origin&&origin!==allowed)return json({error:'Origen no autorizado.',code:'FORBIDDEN'},403);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    try{
      const response=await handler(request,env);
      for(const [key,value] of Object.entries(headers))response.headers.set(key,value);
      return response;
    }catch(error){
      const status=Number(error?.status)||500;
      return json({error:status>=500&&status!==503?'Error del servidor. Conserva las lecturas pendientes.':String(error?.message||'Error'),
        code:error?.code||'SERVER_ERROR'},status,headers);
    }
  }
};
