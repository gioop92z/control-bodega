import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Gym } from '../lib/types';

/** Mapa interactivo (Leaflet + teselas oscuras gratuitas de CARTO/OpenStreetMap). */
export default function GymMap({ gyms, scores, onOpen }: { gyms: Gym[]; scores: Map<string, number | null>; onOpen: (id: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([19.4326, -99.1332], 11);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19, subdomains: 'abcd',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => { map.current?.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();
    const pts: L.LatLngExpression[] = [];
    for (const g of gyms) {
      if (g.lat === null || g.lat === undefined || g.lng === null || g.lng === undefined) continue;
      const s = scores.get(g.id);
      const icon = L.divIcon({ className: '', html: `<div class="gym-pin ${g.status === 'pendiente' ? 'pending' : ''}">${s !== null && s !== undefined ? s.toFixed(1) : '?'}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
      const marker = L.marker([g.lat, g.lng], { icon, title: g.name }).addTo(layer.current);
      const div = document.createElement('div');
      const b = document.createElement('b'); b.textContent = g.name || 'Gimnasio'; div.appendChild(b);
      const p = document.createElement('div'); p.style.fontSize = '12px'; p.textContent = `${g.city ?? ''} · ${g.status}`; div.appendChild(p);
      const btn = document.createElement('button'); btn.className = 'btn sm'; btn.style.marginTop = '6px'; btn.textContent = 'Abrir ficha'; btn.onclick = () => onOpen(g.id); div.appendChild(btn);
      marker.bindPopup(div);
      pts.push([g.lat, g.lng]);
    }
    if (pts.length === 1) map.current.setView(pts[0], 14);
    else if (pts.length > 1) map.current.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
  }, [gyms, scores, onOpen]);
  return <div ref={el} className="map" role="application" aria-label="Mapa de gimnasios" />;
}
