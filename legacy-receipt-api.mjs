// Compatibility path for an existing Supabase project that has not received
// the additive VANTIS 3.10.0 migration. Never impersonate the new RPC contract.
// This path writes through the already-deployed mover_stock_v2 transaction.
import {getMarbete,registerMarbete,assignProductLocation,locationQuery} from './product-location.mjs?v=3.9.5';
import {lookupSupportCodes} from './support-batch.mjs?v=3.8.0';

const fail=(message,code='LEGACY_UNCERTAIN')=>Object.assign(new Error(message),{code});
const ownerMatches=(row,expected)=>!row.user_id||row.user_id===expected;

export class LegacyReceiptApi {
  constructor(sb,deptId){this.sb=sb;this.deptId=deptId;}
  async capabilities(){
    // A successful read from the selected department establishes that this
    // session can reach the existing database. No fake inventory writes.
    const dept=await locationQuery(this.sb.from('departamentos')
      .select('id,activo').eq('id',this.deptId).maybeSingle());
    if(!dept || dept.activo!==true) throw fail('No se pudo validar el departamento en el servidor antiguo.','LEGACY_DENIED');
    return {version:1,mode:'legacy',atomic:false,idempotent:false,guarded:true};
  }
  async activate(code){
    let marbete;
    try{marbete=await getMarbete(this.sb,code,this.deptId);}
    catch(error){
      if(error.code!=='NOT_REGISTERED')throw error;
      if(!/^ZAP-(402|405|459)-\d{3,4}$/.test(code)) throw error;
      marbete=await registerMarbete(this.sb,{code,deptId:this.deptId,zona:'BODEGA'});
    }
    return {codigo:marbete.codigo,departamento_id:marbete.departamento_id,activo:marbete.activo};
  }
  lookup(codes){return lookupSupportCodes(this.sb,codes,this.deptId);}
  movement(id){
    return locationQuery(this.sb.from('movimientos')
      .select('id,tipo,sku,cantidad,departamento_id,marbete_codigo,stock_resultante,created_at,user_id')
      .eq('id',id).maybeSingle());
  }
  receipt(movement,payload,sku,userId){
    if(!movement || movement.id!==payload.p_id ||
       movement.tipo!== 'ENTRADA' || movement.sku!==sku ||
       Number(movement.cantidad)!==1 || movement.departamento_id!==this.deptId ||
       movement.marbete_codigo!==payload.p_marbete ||
       !ownerMatches(movement,userId) ||
       !Number.isSafeInteger(Number(movement.stock_resultante)) ||
       !Number.isFinite(Date.parse(movement.created_at))){
      throw fail('El movimiento existente no coincide con la lectura. No se reenviará.','LEGACY_CONFLICT');
    }
    return {id:payload.p_id,session_id:payload.p_sesion,user_id:userId,operator:payload.p_operador,
      product_id:payload.p_producto,sku,marbete_codigo:payload.p_marbete,
      quantity:1,kind:'receive',stock_resultante:movement.stock_resultante,
      stored_at:movement.created_at,mode:'legacy'};
  }
  async receive(payload,{allowWrite=false,sku,userId}={}){
    if(!payload?.p_id || !payload?.p_sesion || !sku || !userId ||
       !payload.p_operador || !payload.p_producto || !payload.p_marbete ||
       payload.p_departamento!==this.deptId || payload.p_reversa){
      throw fail('Operación incompatible con la recepción antigua.','LEGACY_DENIED');
    }
    // Any re-entry with this UUID is strictly READ ONLY unless this is the
    // first locally journaled send. Missing prior proof is NOT permission to
    // blindly repeat a request after a timeout or browser crash.
    const existing=await this.movement(payload.p_id);
    if(existing)return this.receipt(existing,payload,sku,userId);
    if(!allowWrite)throw fail('No se encontró el recibo de esta lectura incierta. Verifica el historial antes de repetirla.');
    const product=await locationQuery(this.sb.from('productos')
      .select('id,sku,activo,departamento_id').eq('id',payload.p_producto).maybeSingle());
    if(!product||product.sku!==sku||product.activo!==true||product.departamento_id!==this.deptId)
      throw fail('Artículo no disponible en el departamento.','LEGACY_DENIED');
    await assignProductLocation(this.sb,{productId:product.id,sku,deptId:this.deptId,marbeteCode:payload.p_marbete});
    // The old RPC owns the actual stock mutation and movement insert. Never
    // change product stock with client-side UPDATE/UPSERT.
    await locationQuery(this.sb.rpc('mover_stock_v2',{
      p_token:null,p_id:payload.p_id,p_producto:payload.p_producto,p_tipo:'ENTRADA',
      p_cantidad:1,p_marbete:payload.p_marbete,
      p_nota:'RECEPCIÓN CONTINUA COMPATIBLE · Sesión '+payload.p_sesion+' · '+payload.p_operador
    }));
    const stored=await this.movement(payload.p_id);
    if(!stored)throw fail('No apareció el movimiento tras guardar. Requiere verificación, sin nuevo envío.');
    return this.receipt(stored,payload,sku,userId);
  }
}
