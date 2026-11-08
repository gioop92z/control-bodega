import { useEffect, useState, type FormEvent } from "react";
import { summarizeProducts, type Audit, type ManifestIndex } from "../lib/recepcion/audit";
import { request, supabase } from "../lib/recepcion/transport";
import { number } from "./ui";

type Department = { id: string; nombre: string };
export function TransferForm({ id, index, audit }: { id: string; index: ManifestIndex; audit: Audit }) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let canceled = false;
    void supabase.from("departamentos").select("id,nombre").eq("activo", true).order("nombre").then(({ data, error }) => {
      if (!canceled && !error) setDepartments(data ?? []);
    });
    return () => { canceled = true; };
  }, []);
  const products = summarizeProducts(index.rows, audit).filter(item => item.received > 0);
  if (!departments.length || !products.length) return null;
  async function transfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const sku = String(data.get("sku") ?? "").trim().toUpperCase();
    const item = products.find(item => (item.sku || item.upc).toUpperCase() === sku);
    if (!item) { setError("Selecciona un SKU o UPC conciliado."); return; }
    const marbete = String(data.get("marbete") ?? "").trim();
    if (!window.confirm("¿Traspasar " + number.format(item.received) + " piezas de " + sku + " al marbete " + marbete + "?")) return;
    setBusy(true);
    setStatus("");
    setError("");
    try {
      const result = await request<{ id: string; quantity: number; replay?: boolean }>("/api/recepcion", {
        action: "transfer", id, sku, department, marbete,
      });
      setStatus((result.replay ? "Traspaso ya registrado. " : "Traspaso confirmado. ") + result.quantity + " piezas · " + result.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo completar el traspaso."); }
    finally { setBusy(false); }
  }
  return <section className="panel team-panel">
    <h2>Traspasar a inventario</h2>
    <p className="field-hint">Confirma el SKU conciliado, el departamento y el marbete que recibirá las piezas.</p>
    <form className="vantis-transfer" onSubmit={transfer}>
      <label className="field">SKU / UPC<input name="sku" required list="vanifs-transfer-skus" autoComplete="off" /></label>
      <datalist id="vanifs-transfer-skus">{products.map(item => <option key={item.sku || item.upc} value={item.sku || item.upc}>{item.received} piezas</option>)}</datalist>
      <label className="field">Departamento<select value={department} onChange={e => setDepartment(e.target.value)} required>
        <option value="">Seleccionar</option>{departments.map(item => <option key={item.id} value={item.id}>{item.nombre}</option>)}
      </select></label>
      <label className="field">Marbete<input name="marbete" required maxLength={90} autoComplete="off" /></label>
      <button className="button secondary" disabled={busy}>Validar y traspasar</button>
    </form>
    {status && <p className="notice" role="status">{status}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
  </section>;
}
