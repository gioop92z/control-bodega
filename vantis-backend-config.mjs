// VANTIS: conmutación explícita de pruebas, sin modificar la base operativa.
 // La instancia nueva está vacía de usuarios/datos; no realizar el cambio definitivo hasta conciliarla.
const pilot = new URLSearchParams(globalThis.location.search).get('backend') === 'nuevo';
export const vantisBackendConfig = Object.freeze(pilot ? {
  url: 'https://uphnzyembyrouvqohwys.supabase.co',
  key: 'sb_publishable_zpUowBh6NatmD7mb1XDRlw_TVpy1LyT',
  mode: 'NUEVO_EN_PREPARACION'
} : {
  url: 'https://dkqovohxkxlcccvagpij.supabase.co',
  key: 'sb_publishable_iz06RtaObND0dWOpuX2vKg_wZVbrZCv',
  mode: 'LEGACY_PRODUCCION'
});
