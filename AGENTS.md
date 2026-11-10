# VANTIS — instrucciones para agentes de desarrollo

## Skills disponibles

Las 18 skills de Emil Kowalski y sus archivos de apoyo están incorporadas en `.agents/skills/<nombre>/SKILL.md` desde https://github.com/emilkowalski/skills (árbol de origen `715c1807e08c497cfd1dc4feb450a2a3300ef2a9`).
Antes de modificar una interfaz, lee únicamente las skills pertinentes. Son documentación para agentes de desarrollo, **no módulos de ejecución**; instalarlas no cambia la app publicada.

- Interfaz web móvil/iPhone Safari: `mobile-native` y, cuando aplique, `apple-design`.
- Casos extremos, accesibilidad y robustez visual: `break-ui`.
- Evitar demoras en operaciones frecuentes: `remove-animations`, `animation-performance`, `review-animations`.
- Diseñar nuevas interacciones visuales: `emil-design-eng`, `animate`, `gestures` y otras skills pertinentes.
- `animate-expo` o `write-swift` solo al trabajar específicamente en React Native/Expo o Swift. VANTIS es una web: no migrar para usar estas skills.
- `ask-sonner` solo cuando Sonner ya esté instalado o se justifique instalarlo.

## Prioridades de VANTIS

1. Dar prioridad absoluta a la fiabilidad, la rapidez del lector y la continuidad del escaneo.
2. No tocar sin razón la distinción automática entre marbete (ubicación) y SKU/UPC, la asociación de piezas, el proceso de entradas/salidas, la base de datos ni la persistencia.
3. No insertar transiciones, esperas, cambios de foco ni animaciones decorativas en el flujo de escaneo repetitivo.
4. Mantener compatibilidad con Safari de iPhone, cámara y escáner portátil, respetando `prefers-reduced-motion`.
5. Pensar antes de programar; escoger la solución más simple; hacer cambios quirúrgicos; limpiar solo elementos huérfanos causados por el cambio.
6. Ejecutar pruebas aplicables antes de afirmar que un cambio de código está verificado: `npm test` y suites especializadas si están disponibles.

## Licencia

Las skills de terceros conservan la licencia MIT original en `.agents/skills/LICENSE.emilkowalski`.
