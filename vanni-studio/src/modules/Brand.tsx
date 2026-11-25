import { useState } from 'react';
import { Link } from 'react-router';
import { MessageSquarePlus, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { useTable } from '../lib/store';
import { Card, Chips, DateField, Empty, Kpi, NumberField, PageHeader, Select, TagInput, TextArea, TextField, Toggle, Tabs } from '../components/ui';
import { Kanban } from '../components/Kanban';
import { Sheet } from '../components/Sheet';
import { CustomFieldsEditor } from '../components/CustomFields';
import { confirmAction } from '../components/toast';
import { CHANNELS, CONTACT_KINDS, DEAL_KINDS, DEAL_STAGES } from '../lib/constants';
import { dayLabel, relativeTime, today } from '../lib/dates';
import { money } from '../lib/format';
import { useProfile } from '../lib/profile';
import { useCategoryOptions } from './shared';
import type { Contact, Deal, DealStatus } from '../lib/types';

export function DealSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const deals = useTable('deals');
  const contacts = useTable('contacts');
  const interactions = useTable('interactions');
  const tx = useTable('transactions');
  const [note, setNote] = useState('');
  const [channel, setChannel] = useState('dm');
  const d = id ? deals.byId.get(id) : undefined;
  if (!d) return null;
  const set = (patch: Partial<Deal>) => deals.update(d.id, patch);
  const history = interactions.rows.filter((i) => i.deal_id === d.id || (!i.deal_id && i.contact_id && i.contact_id === d.contact_id)).sort((a, b) => b.happened_at.localeCompare(a.happened_at));
  const paid = tx.rows.filter((t) => t.deal_id === d.id && t.kind === 'ingreso').reduce((a, t) => a + Number(t.amount), 0);
  return (
    <Sheet open={!!d} onClose={onClose} title={d.title || 'Colaboración'} wide footer={<><button className="btn danger" type="button" onClick={() => { if (confirmAction('¿Eliminar esta oportunidad?')) { deals.remove(d.id); onClose(); } }}><Trash2 size={15} />Eliminar</button><button className="btn primary" type="button" onClick={onClose}>Listo</button></>}>
      <div className="stack">
        <TextField label="Propuesta / oportunidad" value={d.title} onChange={(v) => set({ title: v })} />
        <div className="field"><span className="field-label">Estado</span><Chips scroll value={d.status} onChange={(v) => set({ status: v as DealStatus })} options={DEAL_STAGES.map((s) => ({ value: s.key, label: s.label }))} /></div>
        <div className="form-grid two">
          <Select label="Marca / contacto" value={d.contact_id ?? ''} placeholder="— Elegir —" onChange={(v) => set({ contact_id: v || null })} options={contacts.rows.map((c) => ({ value: c.id, label: `${c.name}${c.company ? ` · ${c.company}` : ''}` }))} />
          <Select label="Tipo" value={d.kind} onChange={(v) => set({ kind: v })} options={DEAL_KINDS.map((k) => ({ value: k.key, label: k.label }))} />
          <NumberField label="Monto acordado" suffix={d.currency} value={d.amount} onChange={(v) => set({ amount: v })} hint={paid ? `Cobrado: ${money(paid, d.currency)}` : undefined} />
          <TextField label="Moneda" value={d.currency} onChange={(v) => set({ currency: v.toUpperCase().slice(0, 3) })} />
          <DateField label="Inicio" value={d.start_date} onChange={(v) => set({ start_date: v })} />
          <DateField label="Entrega" value={d.due_date} onChange={(v) => set({ due_date: v })} />
          <TextField label="Siguiente acción" value={d.next_action} onChange={(v) => set({ next_action: v })} placeholder="Enviar media kit, seguimiento…" />
          <DateField label="Fecha de la siguiente acción" value={d.next_action_date} onChange={(v) => set({ next_action_date: v })} />
        </div>
        <TextArea label="Entregables" value={d.deliverables} onChange={(v) => set({ deliverables: v })} rows={3} placeholder="2 reels + 3 stories con enlace…" />
        <TextArea label="Notas" value={d.notes} onChange={(v) => set({ notes: v })} rows={2} />
        <TagInput value={d.tags} onChange={(v) => set({ tags: v })} />
        <CustomFieldsEditor entity="deals" value={d.custom} onChange={(v) => set({ custom: v })} />
        <Toggle label="Archivar" checked={d.archived} onChange={(v) => set({ archived: v })} />
        {d.status === 'completado' && d.amount && !paid && <button className="btn" type="button" onClick={() => tx.insert({ day: today(), kind: 'ingreso', amount: d.amount!, currency: d.currency, category: d.kind === 'patrocinio' ? 'patrocinio' : 'colaboracion', description: d.title, deal_id: d.id })}>Registrar el cobro de {money(d.amount, d.currency)}</button>}
        <Card title="Historial de conversaciones">
          <form className="stack tight" onSubmit={(e) => { e.preventDefault(); if (!note.trim()) return; interactions.insert({ contact_id: d.contact_id ?? null, deal_id: d.id, happened_at: new Date().toISOString(), channel, direction: 'saliente', summary: note.trim() }); setNote(''); }}>
            <div className="grid" style={{ gridTemplateColumns: '150px 1fr auto', gap: 6 }}>
              <select className="select" value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Canal">{CHANNELS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Resumen de la conversación…" />
              <button className="icon-btn bordered" type="submit" aria-label="Agregar al historial"><MessageSquarePlus size={18} /></button>
            </div>
          </form>
          <div className="stack tight" style={{ marginTop: 10 }}>{history.map((i) => <div key={i.id} className="small"><span className="badge">{CHANNELS.find((c) => c.key === i.channel)?.label ?? i.channel}</span> <span className="xs faint">{relativeTime(i.happened_at)}</span><div className="pre-wrap">{i.summary}</div></div>)}{!history.length && <span className="xs faint">Sin conversaciones registradas.</span>}</div>
        </Card>
      </div>
    </Sheet>
  );
}

function ContactSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const contacts = useTable('contacts');
  const deals = useTable('deals').rows;
  const interactions = useTable('interactions').rows;
  const kinds = useCategoryOptions('contacts', CONTACT_KINDS);
  const c = id ? contacts.byId.get(id) : undefined;
  if (!c) return null;
  const set = (patch: Partial<Contact>) => contacts.update(c.id, patch);
  return (
    <Sheet open={!!c} onClose={onClose} title={c.name || 'Contacto'} footer={<><button className="btn danger" type="button" onClick={() => { if (confirmAction('¿Eliminar este contacto?')) { contacts.remove(c.id); onClose(); } }}><Trash2 size={15} />Eliminar</button><button className="btn primary" type="button" onClick={onClose}>Listo</button></>}>
      <div className="form-grid two">
        <TextField label="Nombre" value={c.name} onChange={(v) => set({ name: v })} />
        <Select label="Tipo" value={c.kind} onChange={(v) => set({ kind: v })} options={kinds} />
        <TextField label="Empresa / marca" value={c.company} onChange={(v) => set({ company: v })} />
        <TextField label="Puesto" value={c.role} onChange={(v) => set({ role: v })} />
        <TextField label="Instagram" value={c.instagram} onChange={(v) => set({ instagram: v })} placeholder="@usuario" />
        <TextField label="Correo" type="email" inputMode="email" value={c.email} onChange={(v) => set({ email: v })} />
        <TextField label="Teléfono" type="tel" inputMode="tel" value={c.phone} onChange={(v) => set({ phone: v })} />
        <TextField label="Sitio web" type="url" inputMode="url" value={c.website} onChange={(v) => set({ website: v })} />
        <TextField label="Ciudad" value={c.city} onChange={(v) => set({ city: v })} />
        <TextArea className="span-2" label="Notas" value={c.notes} onChange={(v) => set({ notes: v })} />
        <div className="span-2"><TagInput value={c.tags} onChange={(v) => set({ tags: v })} /></div>
        <div className="span-2"><CustomFieldsEditor entity="contacts" value={c.custom} onChange={(v) => set({ custom: v })} /></div>
        <div className="span-2 small muted">{deals.filter((d) => d.contact_id === c.id).length} oportunidades · {interactions.filter((i) => i.contact_id === c.id).length} conversaciones</div>
      </div>
    </Sheet>
  );
}

export function BrandPage() {
  const deals = useTable('deals');
  const contacts = useTable('contacts');
  const rates = useTable('rates');
  const { currency } = useProfile();
  const [tab, setTab] = useState<'pipeline' | 'contactos' | 'tarifas'>('pipeline');
  const [deal, setDeal] = useState<string | null>(null);
  const [contact, setContact] = useState<string | null>(null);
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const active = deals.rows.filter((d) => showArchived || !d.archived);
  const pipelineValue = active.filter((d) => ['negociacion', 'confirmado'].includes(d.status)).reduce((a, d) => a + (d.amount ?? 0), 0);
  const won = deals.rows.filter((d) => d.status === 'completado').reduce((a, d) => a + (d.amount ?? 0), 0);
  const followUps = active.filter((d) => d.next_action_date && d.next_action_date <= today() && d.status !== 'completado');
  const newDeal = (status: DealStatus = 'por_contactar') => setDeal(deals.insert({ title: 'Nueva oportunidad', kind: 'colaboracion', status, currency, archived: false, sort: deals.rows.length }).id);
  return (
    <div>
      <PageHeader eyebrow="Gestión comercial" title="Marca y colaboraciones" description="Marcas, gimnasios, patrocinadores, propuestas, conversaciones, tarifas e ingresos." actions={<><Link className="btn" to="/media-kit"><Sparkles size={16} />Media kit</Link><button className="btn primary" type="button" onClick={() => newDeal()}><Plus size={16} />Oportunidad</button></>} />
      <div className="grid kpis" style={{ marginBottom: 16 }}>
        <Kpi label="Oportunidades activas" value={active.filter((d) => d.status !== 'completado').length} />
        <Kpi label="En negociación / confirmado" value={money(pipelineValue, currency)} />
        <Kpi label="Completado (histórico)" value={money(won, currency)} />
        <Kpi label="Seguimientos pendientes" value={followUps.length} deltaClass={followUps.length ? 'down' : 'flatline'} delta={followUps[0] ? `${followUps[0].next_action ?? 'Acción'} · ${dayLabel(followUps[0].next_action_date!)}` : 'Al día'} />
      </div>
      <div style={{ marginBottom: 14 }}><Tabs value={tab} onChange={setTab} options={[{ value: 'pipeline', label: 'Pipeline' }, { value: 'contactos', label: 'Contactos' }, { value: 'tarifas', label: 'Tarifas' }]} /></div>
      {tab === 'pipeline' && (
        <>
          <Toggle label="Mostrar archivadas" checked={showArchived} onChange={setShowArchived} />
          <Kanban columns={DEAL_STAGES} items={active} columnOf={(d) => d.status} onMove={(d, col) => deals.update(d.id, { status: col as DealStatus })} onOpen={(d) => setDeal(d.id)}
            renderCard={(d) => { const c = d.contact_id ? contacts.byId.get(d.contact_id) : undefined; return <div className="stack tight"><span className="title">{d.title}</span><span className="xs faint">{c?.name ?? 'Sin contacto'}{d.amount ? ` · ${money(d.amount, d.currency)}` : ''}</span>{d.next_action && <span className="xs">→ {d.next_action}{d.next_action_date ? ` (${dayLabel(d.next_action_date)})` : ''}</span>}</div>; }}
            columnFooter={(c) => <button className="btn sm ghost" type="button" onClick={() => newDeal(c.key as DealStatus)}><Plus size={14} />Agregar</button>} />
        </>
      )}
      {tab === 'contactos' && (
        <div className="stack">
          <div className="row wrap"><Chips scroll value={kind} onChange={setKind} options={[{ value: 'all', label: 'Todos' }, ...CONTACT_KINDS.map((k) => ({ value: k.key, label: k.label }))]} /><button className="btn primary sm" type="button" onClick={() => setContact(contacts.insert({ name: '', kind: kind === 'all' ? 'marca' : kind }).id)}><Plus size={14} />Contacto</button></div>
          <div className="row" style={{ gap: 6 }}><Search size={16} color="var(--text-3)" /><input className="input" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {contacts.rows.length ? <div className="list">{contacts.rows.filter((c) => (kind === 'all' || c.kind === kind) && (!q || `${c.name} ${c.company ?? ''} ${c.instagram ?? ''}`.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
            <button key={c.id} type="button" className="list-item" onClick={() => setContact(c.id)}><span className="badge">{CONTACT_KINDS.find((k) => k.key === c.kind)?.label ?? c.kind}</span><span className="grow"><span className="title">{c.name || 'Sin nombre'}</span><br /><span className="xs faint">{[c.company, c.instagram, c.email].filter(Boolean).join(' · ')}</span></span></button>
          ))}</div> : <Empty title="Sin contactos">Agrega marcas, gimnasios, patrocinadores y colaboradores.</Empty>}
        </div>
      )}
      {tab === 'tarifas' && (
        <div className="stack">
          <button className="btn primary" type="button" onClick={() => rates.insert({ name: 'Reel patrocinado', currency, active: true, sort: rates.rows.length })}><Plus size={16} />Tarifa</button>
          {rates.rows.length ? rates.rows.sort((a, b) => a.sort - b.sort).map((r) => (
            <Card key={r.id} tight>
              <div className="form-grid two">
                <TextField label="Servicio" value={r.name} onChange={(v) => rates.update(r.id, { name: v })} />
                <NumberField label="Precio" suffix={r.currency} value={r.price} onChange={(v) => rates.update(r.id, { price: v })} />
                <TextArea className="span-2" label="Incluye" value={r.description} onChange={(v) => rates.update(r.id, { description: v })} rows={2} />
                <Toggle label="Mostrar en el media kit" checked={r.active} onChange={(v) => rates.update(r.id, { active: v })} />
                <button className="btn sm ghost" type="button" onClick={() => rates.remove(r.id)}><Trash2 size={14} />Eliminar</button>
              </div>
            </Card>
          )) : <Empty title="Sin tarifas">Define tus precios por formato para usarlos en propuestas y en el media kit.</Empty>}
        </div>
      )}
      <DealSheet id={deal} onClose={() => setDeal(null)} />
      <ContactSheet id={contact} onClose={() => setContact(null)} />
    </div>
  );
}
