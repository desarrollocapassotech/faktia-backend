**FAKTIA**

**Documentación Funcional - Módulos del sistema**

Análisis Funcional - Faktia · Implementación para Ale Herrería

Borrador para revisión, redactado a partir del presupuesto aceptado por Ale Herrería (09/10/2026) y del estado actual del código de Faktia. Describe todos los módulos que va a usar Alexis, primer cliente de Faktia. Cada módulo se construye a su medida, pero con nombres y reglas genéricas para reutilizarlo con clientes de otros rubros. Las decisiones que faltan cerrar se juntan en la sección 13.

# 1. Datos generales del sistema

|                                  |                                                                                                                                                              |
|----------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Sistema**                      | Faktia: plataforma de gestión y facturación para pymes, multi-tenant y modular. Cada cliente (tenant) usa solo los módulos que tiene habilitados.            |
| **Responsable funcional**        | Elías Capasso                                                                                                                                                |
| **Fecha de última revisión**     | 24/11/2026                                                                                                                                                   |
| **Primer cliente**               | Alexis Nahuel Herman: Ale Herrería (herrería y estructuras metálicas, General Ramírez, Entre Ríos). Responsable Inscripto. La administración la lleva Rocío. |
| **Alcance contratado**           | Etapa 1: Presupuestos, Materiales y Cuenta corriente por obra con recibos. Plazo aproximado: 3 a 4 meses con entregas parciales.                             |
| **Fuera del alcance contratado** | Control de stock, cálculo automático de materiales a partir de medidas y facturación electrónica (ARCA). Esta última ya existe en Faktia y se ofrece aparte. |

# 2. Propósito del sistema

Ale Herrería hoy arma presupuestos, listados de materiales y recibos en Word, copiando y pegando documentos anteriores y recalculando a mano los saldos de cada obra. El sistema reemplaza ese trabajo por documentos generados con su diseño y sus datos, una biblioteca de textos frecuentes y el seguimiento automático de lo acordado, lo cobrado y lo pendiente en cada obra.

Para Faktia, Ale es el primer uso real. Todo lo que se construye para él queda disponible como módulo genérico: el nombre "Obra" es una etiqueta configurable de la entidad Proyecto, los ítems frecuentes y las observaciones son catálogos que carga cada tenant, y los catálogos de materiales sirven igual para cualquier rubro que compre o liste insumos.

# 3. Roles que lo utilizan

- **Usuario del tenant:** usa todos los módulos habilitados: arma presupuestos y listados, gestiona clientes y obras, registra entregas y emite recibos. En Ale Herrería: Ale y Rocío. En la v1 todos los usuarios del tenant pueden hacer todo; no hay permisos distintos.

- **Administrador de Faktia (CapassoTech):** da de alta el tenant, habilita módulos, configura etiquetas y plantillas, y da soporte.

- **Cliente final y proveedores:** no acceden al sistema. Reciben los PDF: presupuestos, recibos y facturas (clientes), y listados de materiales (proveedores).

# 4. Mapa de módulos y alcance

Estado de cada módulo respecto del código actual de Faktia:

| **Módulo**               | **Qué resuelve**                                                         | **Estado**                    | **Entrega** |
|--------------------------|--------------------------------------------------------------------------|-------------------------------|-------------|
| Configuración del tenant | Datos fiscales, plantilla de documentos, módulos habilitados y etiquetas | Existe, adaptar               | 1           |
| Clientes                 | Padrón de clientes compartido por todos los módulos                      | Existe, adaptar               | 1           |
| Proyectos (Obras)        | Monto acordado, plan de pagos, entregas y saldo por obra                 | Nuevo                         | 1           |
| Cuenta corriente         | Deuda y pagos por cliente, vencimientos, saldos                          | Existe, adaptar               | 1           |
| Recibos                  | Recibo en PDF de cada entrega                                            | Existe, adaptar               | 1           |
| Presupuestos             | Presupuestos con su diseño, biblioteca de ítems y observaciones          | Nuevo                         | 2           |
| Materiales               | Catálogo de materiales y listados por obra                               | Nuevo                         | 3           |
| Facturación electrónica  | Facturas A/B/C y notas de crédito y débito en ARCA                       | Existe, fuera del presupuesto | Opcional    |

El orden de entregas prioriza lo que Ale usa todas las semanas: registrar anticipos y entregas de obras en curso. Le siguen los presupuestos (el módulo más grande) y los materiales. Los módulos internos de Faktia que Ale no usa (importaciones, integraciones por API, webhooks) quedan ocultos para su tenant.

# 5. Módulo Configuración del tenant

|             |                                                                                                                              |
|-------------|------------------------------------------------------------------------------------------------------------------------------|
| **Estado**  | Existe (datos del emisor, puntos de venta, plantilla PDF con logo y pie). Se agregan módulos habilitados, etiquetas y firma. |
| **Entrega** | 1                                                                                                                            |

## Propósito

Concentrar los datos que aparecen en todos los documentos y decidir qué módulos ve cada tenant. Hoy Ale repite en cada Word su encabezado: domicilio, teléfono, CUIT, Ingresos Brutos, inicio de actividades y condición frente al IVA, y la firma "ATTE. ALEXIS NAHUEL HERMAN".

## Flujo principal

1.  CapassoTech da de alta el tenant con sus datos fiscales y habilita los módulos contratados.

2.  Se cargan el logo, el color principal, el pie y la firma, que usan todos los PDF del tenant: presupuestos, listados, recibos y facturas.

3.  Se configura la etiqueta de proyectos (singular y plural): para Ale, "Obra" / "Obras".

4.  El menú y las pantallas muestran solo los módulos habilitados.

## Reglas de negocio

- Un cambio en la plantilla impacta en los documentos que se generen desde ese momento. Los recibos emitidos conservan los importes y el estado del proyecto de su fecha.

- Un módulo deshabilitado no aparece en el menú y el backend rechaza sus operaciones.

- Los datos fiscales son únicos por tenant; los documentos guardan una copia de los datos del emisor al momento de emitirse.

## Entidades principales

- **Tenant:** datos fiscales, módulos habilitados, etiquetas de proyecto.

- **Plantilla de documentos:** logo, color, pie y firma.

# 6. Módulo Clientes

|             |                                                                                                           |
|-------------|-----------------------------------------------------------------------------------------------------------|
| **Estado**  | Existe (alta, edición, validación de CUIT, consulta al padrón de ARCA). Se adapta para clientes sin CUIT. |
| **Entrega** | 1                                                                                                         |

## Propósito

Tener un único padrón de clientes que usan presupuestos, obras, cuenta corriente, recibos y facturas. Los clientes de Ale van de una cooperativa o una municipalidad, con CUIT, a particulares de los que solo tiene el nombre y la dirección.

## Flujo principal

1.  El usuario da de alta un cliente con nombre o razón social, dirección y, si lo tiene, CUIT o DNI.

2.  Si carga un CUIT, el sistema valida el dígito verificador y puede completar razón social, domicilio y condición de IVA desde el padrón de ARCA.

3.  También se puede crear un cliente rápido desde un presupuesto o una obra, sin salir de esa pantalla.

## Reglas de negocio

- El CUIT es obligatorio solo para facturar; para presupuestos, obras y recibos alcanza con el nombre.

- No se repite un mismo CUIT o DNI dentro del tenant.

- Un cliente con movimientos, obras o documentos no se elimina: se desactiva.

## Casos borde y excepciones

- Hoy el sistema identifica a los clientes sin documento con el número "0" y no permite dos clientes con el mismo tipo y número de documento, así que solo puede existir uno sin documento. Hay que permitir varios clientes sin documento (Diego Streck, Wilson Carrillo).

- Un mismo cliente con varias sedes (La Agrícola Regional: complejo de Crespo, sucursal Costa Doll) es un solo cliente con varias obras, no varios clientes.

# 7. Módulo Proyectos (Obras)

|                       |                                                |
|-----------------------|------------------------------------------------|
| **Estado**            | Nuevo. Se apoya en Cuenta corriente y Recibos. |
| **Entrega**           | 1                                              |
| **Etiqueta para Ale** | "Obra" / "Obras"                               |

## Propósito

Seguir cada trabajo como una unidad propia: cuánto se acordó, en qué partes y cuándo se cobra (hitos), cuánto entregó el cliente y cuánto falta. Un cliente puede tener varias obras en paralelo, cada una con su moneda y su saldo.

## Flujo principal

### Alta de una obra

1.  El usuario crea la obra para un cliente: nombre, ubicación, moneda (pesos o dólares), monto acordado (opcional) y modo de IVA.

2.  Opcionalmente divide el monto acordado en hitos (el plan de pagos): descripción, importe y vencimiento si lo tiene. Si no carga hitos, el acordado queda como un único importe.

3.  Cada hito se registra como deuda en la cuenta corriente del cliente, asociada a la obra.

### Registro de una entrega

1.  El usuario registra una entrega en la obra: fecha, importe, moneda y medio de pago.

2.  Si la entrega está en otra moneda, se convierte al tipo de cambio: la cotización oficial de ARCA por defecto, editable en cada entrega, o el tipo de cambio fijado para esa obra.

3.  Se genera el recibo y el pago se descuenta de los hitos en orden.

### Cobro por certificación de avance

1.  Un hito puede marcarse "por certificación" (por ejemplo, "Según avance de obra"). Su importe total cuenta en el saldo de la obra, pero no es exigible de entrada.

2.  A medida que avanza el trabajo, el usuario carga certificaciones de importe variable: fecha, descripción del avance, importe y vencimiento.

3.  Cada certificación pasa a ser exigible: aparece en vencimientos y alertas y los pagos se imputan a ella. Lo que todavía no se certificó se muestra como "a certificar".

4.  La suma de las certificaciones no puede superar el importe del hito; si el trabajo crece, la diferencia se carga como adicional.

### Facturación de una obra

1.  Si se factura una obra con monto acordado, la factura no vuelve a sumar ese trabajo a la deuda, porque ya está contado en el acordado.

2.  Según el modo de IVA de la obra: "Acordado final": la factura no suma nada; "Más IVA": suma solo el IVA de esa factura (una nota de crédito lo resta).

3.  Si la obra no tiene monto acordado, la factura suma su total, como cualquier factura.

## Ejemplo real

Obra para La Agrícola Regional, sucursal Costa Doll: \$17.300.000 más IVA.

| **Hito**                            | **Importe**  | **Vencimiento** |
|-------------------------------------|--------------|-----------------|
| Anticipo                            | \$2.595.000  | Al confirmar    |
| Según avance de obra                | \$13.385.000 | Sin fecha fija  |
| Al terminar (llenado de 4 columnas) | \$1.320.000  | Al finalizar    |

Con el anticipo cobrado, el saldo es \$14.705.000, igual que en el recibo actual. El hito "según avance de obra" es por certificación: si se certifica un primer avance de \$5.000.000, eso pasa a ser exigible y los \$8.385.000 restantes quedan "a certificar". Una Factura A por \$5.000.000 + IVA suma solo \$1.050.000 (el IVA).

## Reglas de negocio

- Una obra pertenece a un solo cliente, tiene una sola moneda y su nombre no se repite dentro del cliente.

- Los hitos suman el monto acordado y se pueden editar mientras no tengan pagos imputados. Los trabajos adicionales se cargan como deuda aparte, asociada a la obra.

- El modo de IVA es por obra, lo que permite trabajar de forma mixta (obras con y sin IVA; partes facturadas y partes cobradas solo con recibo). Se puede cambiar y el sistema recalcula.

- Un pago de una obra solo se imputa a deudas de esa obra; el excedente queda a cuenta.

- Prioridad del tipo de cambio: el editado en el pago, el fijado en la obra, la cotización oficial de ARCA del día. Se guardan el importe y la moneda originales.

- Los hitos por certificación solo son exigibles en la parte certificada. El saldo total de la obra incluye lo no certificado; el saldo exigible, no.

- Avisos por email: el sistema avisa a los usuarios del tenant de los hitos y certificaciones que están por vencer o vencidos.

- Las entregas de obras ya en curso (por ejemplo, las de 2024 de Wilson Carrillo) se cargan como pagos manuales con su fecha original, sin recibo.

## Casos borde y excepciones

- Una obra con movimientos no se elimina: se finaliza o se cancela. Se puede finalizar con saldo pendiente; el saldo sigue en la cuenta corriente.

- Si se cambia el monto acordado después de cobrar, solo se modifican los hitos sin pagos; el resto se ajusta con adicionales o ajustes trazables.

- Una obra en dólares cobrada en pesos mantiene su saldo en dólares; cada pago queda con su tipo de cambio.

## Entidades principales

- **Proyecto:** cliente, nombre, ubicación, estado (en curso, finalizado, cancelado), moneda, monto acordado, modo de IVA, tipo de cambio fijo y fechas.

- **Hito:** parte del acordado con descripción, importe, orden, vencimiento opcional y si es por certificación. Se registra como deuda en la cuenta corriente.

- **Certificación:** avance de un hito por certificación, con fecha, descripción, importe y vencimiento. Es la parte exigible del hito.

# 8. Módulo Cuenta corriente

|             |                                                                                                                      |
|-------------|----------------------------------------------------------------------------------------------------------------------|
| **Estado**  | Existe (débitos y créditos, imputaciones, saldos por moneda, vencimientos). Se agregan obras y conversión de moneda. |
| **Entrega** | 1                                                                                                                    |

## Propósito

Saber en todo momento cuánto debe cada cliente, desde cuándo y qué vence. Es la base contable sobre la que trabajan Obras, Recibos y Facturación: ninguno guarda saldos propios.

## Flujo principal

1.  Las deudas nacen de los hitos de las obras, de los adicionales, de las facturas (según las reglas de Obras) o de movimientos manuales (saldo inicial, ajustes).

2.  Los pagos nacen de los recibos de cobro o de movimientos manuales (pagos sin recibo, notas de crédito).

3.  Cada pago se imputa a una o varias deudas; lo que sobra queda a cuenta.

4.  El resumen muestra el saldo de todos los clientes, lo vencido y lo que vence en los próximos días.

5.  El sistema envía por email a los usuarios del tenant un aviso con lo que está por vencer y lo vencido.

## Reglas de negocio

- El saldo es siempre la suma de deudas menos la de pagos; nunca se edita a mano.

- No se mezclan monedas: los saldos se muestran por moneda y los pagos se convierten a la moneda de la deuda que cancelan.

- Los movimientos que generan otros módulos no se editan a mano (salvo el vencimiento); se corrigen desde su origen o con un ajuste.

- El saldo del cliente es la suma de sus obras y de sus movimientos sin obra.

- Se distingue el saldo total del saldo exigible: lo que falta certificar de una obra suma al total pero no se considera vencido ni genera avisos.

## Entidades principales

- **Movimiento:** deuda o pago, con origen (hito, factura, recibo, manual), importe, moneda, fecha, vencimiento, obra opcional y datos de conversión.

- **Imputación:** cuánto de un pago cancela una deuda puntual.

# 9. Módulo Recibos

|             |                                                                                                                                                                           |
|-------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Estado**  | Existe (recibos de cobro y de pago con PDF y plantilla). Se agregan obra, estado de la obra y formato de constancia de entregas. Para Ale se ocultan los recibos de pago. |
| **Entrega** | 1                                                                                                                                                                         |

## Propósito

Emitir en el momento un comprobante de cada entrega, listo para reenviar al cliente, sin reescribir a mano la lista de pagos ni recalcular el saldo.

## Flujo principal

1.  Al registrar una entrega en una obra (o un cobro suelto a un cliente), el sistema genera el recibo de cobro.

2.  El PDF sigue el formato que Ale ya usa: constancia de la entrega, monto acordado, lista de entregas con fecha, saldo pendiente y, si corresponde, hitos que faltan (por ejemplo, "facturación según avance de obra" y "saldo al terminar").

3.  Si hubo conversión de moneda, el recibo muestra el equivalente y el tipo de cambio usado.

4.  El recibo queda en el historial y se puede volver a descargar.

## Reglas de negocio

- El recibo guarda una copia del estado de la obra al momento de emitirlo: al volver a descargarlo muestra el saldo de esa fecha, no el actual.

- El recibo no es una factura y lo indica en el PDF.

- Los recibos de pago (a empleados, contratistas o proveedores) se pueden ocultar por tenant. Ale usa solo recibos de cobro.

- Anular un recibo revierte su pago en la cuenta corriente con un movimiento trazable; no se borra en silencio.

## Entidades principales

- **Recibo:** tipo (cobro o pago), número, fecha, moneda, total, cliente, obra opcional, ítems, medio de pago, observaciones y copia del estado de la obra.

# 10. Módulo Presupuestos

|             |       |
|-------------|-------|
| **Estado**  | Nuevo |
| **Entrega** | 2     |

## Propósito

Armar presupuestos con el diseño de Ale en minutos, eligiendo ítems de una biblioteca en lugar de copiar y pegar de presupuestos anteriores, y tener el historial ordenado. Los presupuestos reales de Ale muestran tres formas de cotizar: por ítem (Diego Streck: cada trabajo con su importe), por total global (Municipalidad: varios trabajos y un solo total) y por superficie (La Agrícola Regional: medidas del galpón, metros cuadrados a cubrir y total).

## Flujo principal

1.  El usuario crea un presupuesto: elige un cliente (o lo da de alta en el momento) e indica la obra o el lugar del trabajo. El sistema le asigna el número siguiente (P-0000001, P-0000002…) y la fecha de vencimiento según la validez.

2.  Agrega ítems: cantidad y descripción. Puede elegirlos de la biblioteca de ítems frecuentes (desmontajes, columnas, vigas, techado, canaletas, cenefas…) y adaptarlos, o escribirlos de cero. Las descripciones admiten negrita, cursiva, subrayado y colores.

3.  Elige la forma de cotizar: importe por ítem con total sumado, total global, o por superficie (ancho, largo, alturas, metros cuadrados a cubrir e importe).

4.  Elige cómo mostrar el IVA: sin IVA, con la observación "no incluye IVA", o con el IVA discriminado y el total con IVA.

5.  Tilda las observaciones que correspondan del catálogo: IVA no incluido, materiales incluidos o no, plazo de obra, condición de pago, servicios incluidos (grúa, autoelevador…), uso de grúa mayor a 14 m, adicionales en obra, documentación. Las que llevan un valor (por ejemplo, "Plazo de obra: 120 días hábiles") se completan en el momento.

6.  Genera el PDF con su plantilla, listo para enviar.

7.  Más adelante puede duplicarlo para armar uno parecido, o marcarlo como aceptado y crear la obra a partir de él.

## Reglas de negocio

- La numeración es automática y correlativa por tenant, con el formato P-0000001. Para Ale arranca en P-0000001.

- Cada presupuesto tiene fecha de vencimiento. Si llega esa fecha sin estar aceptado ni rechazado, pasa solo a "vencido".

- El IVA es configurable por presupuesto: se puede mostrar discriminado con el total con IVA, o solo indicar que no está incluido.

- El presupuesto no es un comprobante fiscal: no se envía a ARCA y no genera deuda en la cuenta corriente.

- Moneda en pesos o dólares.

- Los ítems de la biblioteca son plantillas: al usarlos se copian al presupuesto y editarlos ahí no modifica la biblioteca.

- El presupuesto guarda una copia de los datos del cliente y del emisor; cambiarlos después no modifica presupuestos ya emitidos.

- Estados: borrador, enviado, aceptado, rechazado y vencido. Solo un presupuesto aceptado puede crear una obra. Un presupuesto vencido se puede duplicar con fecha nueva.

- El formato de las descripciones se limita a negrita, cursiva, subrayado y color de texto. Hay una paleta fija con los colores de la marca, se puede elegir cualquier otro color y los más usados aparecen al lado (se recuerdan en cada navegador).

## Casos borde y excepciones

- Un presupuesto para alguien que todavía no es cliente: se da de alta como cliente sin CUIT y se completa si después acepta.

- Carga inicial: Ale entrega presupuestos anteriores y con ellos se cargan los ítems frecuentes y las observaciones de entrada.

- Un presupuesto aceptado con modificaciones: se duplica, se ajusta y el nuevo reemplaza al anterior, que queda como rechazado.

- Al crear la obra desde un presupuesto aceptado, se copian el cliente, el nombre del trabajo, la moneda y el total como monto acordado; los hitos se cargan a partir de la condición de pago.

## Entidades principales

- **Presupuesto:** número, fecha, fecha de vencimiento, cliente, lugar de la obra, moneda, forma de cotizar, datos de superficie, cómo se muestra el IVA, subtotal, IVA, total, estado, observaciones elegidas y copias de los datos de cliente y emisor.

- **Ítem de presupuesto:** cantidad, descripción con formato, importe opcional y orden.

- **Ítem frecuente (biblioteca):** título, descripción con formato y categoría.

- **Observación (catálogo):** texto, si lleva un valor a completar y si viene tildada por defecto.

# 11. Módulo Materiales

|             |       |
|-------------|-------|
| **Estado**  | Nuevo |
| **Entrega** | 3     |

## Propósito

Armar los pedidos y cálculos de materiales de cada obra eligiendo de un catálogo, en lugar de escribir la lista entera cada vez, y enviarlos en PDF al proveedor o al cliente. El listado real de Ale para un galpón tiene más de 30 renglones (hierros, perfiles, chapas, bulones, tornillos, pintura, hormigón) con unidades distintas.

## Flujo principal

1.  El usuario carga sus proveedores: nombre o razón social, CUIT opcional, contacto, teléfono y email.

2.  Carga su catálogo de materiales: nombre, unidad (barras, metros, chapas, unidades, litros, m³, kg, rollos…), precio de costo y precio de venta (cada uno en pesos o dólares), categoría y proveedor habitual opcionales.

3.  Actualiza precios cuando cambian; el sistema guarda la fecha de la última actualización.

4.  Arma un listado para una obra: título (por ejemplo, "Cálculo aproximado de materiales para galpón"), proveedor destinatario (opcional), destino o dirección de entrega, y renglones con cantidad y material del catálogo (o texto libre para algo puntual).

5.  Agrega observaciones (por ejemplo, qué no contempla el cálculo) y elige qué precios muestra el PDF: ninguno, de costo o de venta.

6.  Genera el PDF para el proveedor (sin precios, para pedir cotización) o para el cliente (con precios de venta, si corresponde).

## Reglas de negocio

- Cada material tiene precio de costo y precio de venta, cada uno en pesos o dólares. Los totales de un listado se calculan por moneda.

- Los proveedores son una entidad genérica del tenant, pensada también para clientes de otros rubros; un proveedor con listados no se elimina, se desactiva.

- El listado guarda una copia del nombre, la unidad y los precios de cada material al momento de armarlo; actualizar el catálogo no cambia listados anteriores.

- Un listado puede estar vinculado a una obra y a un presupuesto, o ser suelto.

- Un material usado en listados no se elimina: se desactiva.

- El módulo no maneja stock ni calcula cantidades a partir de medidas (módulos futuros, fuera de este presupuesto).

## Entidades principales

- **Proveedor:** nombre o razón social, CUIT opcional, contacto, teléfono, email y estado.

- **Material:** nombre, unidad, precio de costo y su moneda, precio de venta y su moneda, categoría, proveedor habitual, fecha de actualización y estado.

- **Listado de materiales:** título, obra, presupuesto y proveedor opcionales, destino, observaciones y qué precios muestra.

- **Renglón:** cantidad, material (o texto libre), unidad y precios copiados.

# 12. Módulo Facturación electrónica

|             |                                                                                                                                        |
|-------------|----------------------------------------------------------------------------------------------------------------------------------------|
| **Estado**  | Existe y está probado contra ARCA homologación (facturas A, B y C, notas de crédito y débito, PDF con QR). Falta el pase a producción. |
| **Entrega** | Opcional, fuera del presupuesto aceptado. Posiblemente más adelante; se cotiza aparte.                                                 |

## Propósito

Ale la va a sumar posiblemente más adelante. Que Ale emita sus facturas desde el mismo sistema donde tiene sus obras. Como Responsable Inscripto, factura con A a empresas, cooperativas y organismos (La Agrícola Regional, la Municipalidad) y con B a consumidores finales.

## Flujo principal

1.  Se configuran el certificado de ARCA y el punto de venta de Ale.

2.  El usuario arma la factura para un cliente con CUIT o documento, la vincula opcionalmente a una obra y la emite.

3.  ARCA devuelve el CAE y el sistema genera el PDF con QR.

4.  Si la factura está vinculada a una obra, impacta en la cuenta corriente según el modo de IVA de la obra (ver sección 7).

## Reglas de negocio

- La letra de la factura depende de la condición de IVA del emisor y del receptor; el sistema advierte si no corresponde.

- Una factura emitida no se modifica: se corrige con nota de crédito o débito.

- La emisión es idempotente: un reintento no genera una factura duplicada.

# 13. Decisiones tomadas

Respuestas de la revisión con el cliente, ya incorporadas en cada módulo:

| **Tema**                   | **Decisión**                                                                      |
|----------------------------|-----------------------------------------------------------------------------------|
| Permisos                   | Todos los usuarios del tenant pueden hacer todo.                                  |
| IVA en presupuestos        | Configurable: en algunos casos se muestra el IVA discriminado y el total con IVA. |
| Validez de presupuestos    | Tienen fecha de vencimiento y pasan solos a "vencido".                            |
| Numeración de presupuestos | Empieza en P-0000001.                                                             |
| Biblioteca inicial         | Ale entrega presupuestos anteriores para cargar ítems frecuentes y observaciones. |
| Hitos "según avance"       | Se cobran en partes de importe variable: certificaciones.                         |
| Alertas                    | Avisos por email de hitos y certificaciones por vencer o vencidos.                |
| Recibos de pago            | Se ocultan para Ale.                                                              |
| Precios de materiales      | Precio de costo y de venta, cada uno en pesos o dólares.                          |
| Proveedores                | Se cargan como entidad propia, genérica para otros rubros.                        |
| Facturación electrónica    | Posiblemente más adelante.                                                        |

# 14. Preguntas abiertas

Surgen de las respuestas anteriores:

- **Alertas:** ¿quién recibe los avisos (Ale, Rocío o ambos), con cuántos días de anticipación, y prefiere un resumen diario o un aviso por cada vencimiento?

- **Certificaciones:** ¿se certifica por importe o por porcentaje de avance? ¿Cada certificación se factura y se le envía un documento de certificación al cliente?

- **IVA en presupuestos:** ¿siempre 21% o a veces otra alícuota (por ejemplo, 10,5%)?

- **Validez por defecto:** ¿cuántos días de validez lleva un presupuesto si no se indica otra cosa?

- **Precio de venta de materiales:** ¿se carga a mano o se calcula con un margen sobre el costo?

Una vez cerradas estas preguntas, queda definido el alcance de cada entrega y se pasa a diseño técnico módulo por módulo.
