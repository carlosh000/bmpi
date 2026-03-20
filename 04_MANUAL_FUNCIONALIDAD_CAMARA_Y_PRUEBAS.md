# 04 MANUAL DE FUNCIONALIDAD CON CAMARA Y PRUEBAS - BMPI

Fecha de corte: 2026-03-20
Objetivo: dejar una guia practica para operar y validar el sistema de asistencia facial centrado en camara + reconocimiento.

## 1. Alcance de este manual

Este manual cubre:

- Como conectar y habilitar camara en Windows.
- Como levantar BMPI para que la camara funcione con reconocimiento.
- Como ejecutar pruebas funcionales (positivo, negativo y estabilidad).
- Como registrar evidencia para entrega.

No cubre desarrollo de nuevas funcionalidades.

## 2. Requisitos minimos

Hardware:

- PC Windows con camara USB o camara integrada.
- Iluminacion frontal estable (evitar contraluz).

Software:

- PostgreSQL activo y accesible.
- Entorno Python en `.venv` listo para IA.
- Node/npm y Go instalados.

Puertos esperados:

- IA gRPC: `50051`
- Backend REST: `8080`
- Frontend Angular dev: `4200` (o el puerto libre que asigne)

## 3. Conexion de camara (Windows)

1. Conecta la camara al puerto USB directo (evitar hubs inestables).
2. Cierra apps que puedan tomar la camara (Teams, Zoom, WhatsApp Desktop, navegador en otra pestaña).
3. En Windows, valida permisos:
   - Configuracion -> Privacidad y seguridad -> Camara
   - Activar acceso a camara para el dispositivo
   - Activar acceso para aplicaciones de escritorio
4. En navegador (donde corre BMPI), permite camara cuando aparezca el popup de permisos.

Resultado esperado:

- Al entrar a la vista "Reconocimiento entrada" y presionar "Iniciar camara", debe mostrarse video en vivo.

## 4. Arranque recomendado para operacion con camara

Desde raiz del proyecto:

```powershell
& c:\Users\practicante\Desktop\bmpi-main\.venv\Scripts\Activate.ps1
powershell.exe -ExecutionPolicy Bypass -File ".\scripts\iniciar_bmpi.ps1" -Mode dev -WindowStyle Hidden
```

Notas operativas:

- Se recomienda `-WindowStyle Hidden` para que las ventanas auxiliares (IA/backend) no estorben.
- La terminal principal debe quedarse abierta porque ahi corre `ng serve`.
- No cerrar procesos de PowerShell si son parte del stack.

Mensajes esperados en arranque:

- `IA gRPC lista en :50051`
- `Backend REST listo en :8080`
- `Local: http://localhost:<puerto>`

## 5. Flujo funcional completo con camara

## 5.1 Alta de empleado (prerrequisito para reconocer)

1. Iniciar sesion con rol con permisos de embeddings (admin o rh).
2. Ir a seccion de carga de fotos del empleado.
3. Cargar al menos 4-5 fotos con buena calidad (rostro centrado, sin blur, sin sombras fuertes).
4. Guardar registro.

Resultado esperado:

- El backend responde exitoso en `POST /api/employees/register-photos`.
- El empleado queda disponible para reconocimiento.

## 5.2 Reconocimiento por camara (operacion diaria)

1. Iniciar sesion con rol que pueda reconocimiento (admin, vigilante, operator segun configuracion actual).
2. Ir a "Reconocimiento entrada".
3. Presionar `Iniciar camara`.
4. Esperar estado: `Camara activa. Esperando rostro...`
5. Mantener rostro 1-2 segundos frente a camara.

Resultado esperado:

- El sistema ejecuta rafaga, decide por votos/confianza y muestra:
  - `Reconocido: <nombre o id> ...`
- Si `registerAttendance=true`, se registra asistencia en backend.

## 6. Pruebas funcionales obligatorias (checklist)

## Prueba A - Camara en vivo

Pasos:

1. Abrir vista de reconocimiento.
2. Presionar `Iniciar camara`.

Pasa si:

- Hay video en vivo sin pantalla negra.
- No aparece error de permisos.

## Prueba B - Reconocimiento positivo

Pasos:

1. Usar persona con fotos previamente registradas.
2. Colocarse frente a camara.

Pasa si:

- Mensaje de reconocido con confianza y votos.
- Se refleja registro de asistencia.

## Prueba C - No reconocido (control)

Pasos:

1. Probar con persona no registrada.

Pasa si:

- Mensaje de "Sin reconocimiento".
- No crea asistencia falsa.

## Prueba D - Estabilidad basica

Pasos:

1. Ejecutar 10 intentos seguidos de reconocimiento positivo.

Pasa si:

- No cae frontend/backend/IA.
- Tasa de exito coherente (sin errores masivos por timeout).

## Prueba E - Reconexion rapida de camara

Pasos:

1. `Detener camara`.
2. `Iniciar camara` nuevamente.
3. Repetir 3 veces.

Pasa si:

- La camara vuelve a abrir en cada ciclo.
- No queda bloqueada la vista.

## 7. Evidencia minima de entrega

Guardar para traspaso:

1. Captura de terminal con stack arriba (`50051`, `8080`, `4200/420x`).
2. Captura de vista con video en vivo.
3. Captura de reconocimiento positivo.
4. Captura de no reconocido.
5. Export o consulta donde se vea la asistencia creada por reconocimiento.

## 8. Variables clave para ajuste de reconocimiento

Archivo dev: `scripts/.env.dev`

Parametros mas importantes:

- `BMPI_FACE_THRESHOLD=0.55`
- `BMPI_RECOGNIZE_BURST_MAX_FRAMES=7`
- `BMPI_RECOGNIZE_BURST_MIN_VOTES=2`
- `BMPI_RECOGNIZE_BURST_MIN_CONFIDENCE=0.35`
- `BMPI_RECOGNIZE_BURST_RPC_TIMEOUT_MS=7000`

Regla practica:

- Si hay falsos positivos, hacer mas estricto (`threshold` menor o subir votos/confianza minima).
- Si hay falsos negativos en buena luz, relajar gradualmente y volver a probar.

## 9. Solucion de problemas comunes

## 9.1 "No se pudo abrir la camara"

Acciones:

1. Revisar permisos de camara en Windows y navegador.
2. Cerrar apps que usen camara.
3. Recargar frontend y volver a intentar.

## 9.2 Pantalla negra o congelada

Acciones:

1. `Detener camara` y `Iniciar camara`.
2. Cambiar puerto USB o reconectar camara.
3. Reiniciar navegador.

## 9.3 Reconocimiento falla siempre

Acciones:

1. Confirmar que el empleado tenga embeddings cargados.
2. Revisar iluminacion y encuadre.
3. Verificar que IA este arriba en `:50051`.
4. Revisar logs de backend/IA para errores de gRPC o timeout.

## 9.4 Ventanas PowerShell cerradas y se cae el sistema

Acciones:

1. No cerrar ventanas que levantan procesos de IA/backend.
2. Usar `-WindowStyle Hidden` para que corran sin estorbar visualmente.
3. Mantener abierta la terminal principal de `ng serve`.

## 10. Comandos utiles de soporte

Detener stack:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\detener_bmpi.ps1 -Mode dev
```

Smoke de registro de fotos (prueba rapida API):

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\smoke_prod_registro_fotos.ps1 -EmployeeId 9500 -EmployeeName "Prod Smoke" -PhotoDir "datasets/empresa_eval_20260220/known/200"
```

Evaluacion de calidad/precision de dataset:

```powershell
python scripts\evaluar_ia_empresa.py --dataset datasets\empresa_eval_YYYYMMDD --output reports\ia
```

## 11. Criterio de cierre funcional (camara)

El modulo camara se considera aceptable para continuidad cuando:

1. Camara abre en vivo sin errores de permisos.
2. Reconoce al menos 1 empleado registrado en pruebas controladas.
3. No registra asistencia para persona no registrada.
4. Mantiene estabilidad en pruebas repetidas.
5. Queda evidencia de pruebas y capturas.
