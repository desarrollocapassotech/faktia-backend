// Carga inicial de la biblioteca para una herrería (sale de los presupuestos de Ale Herrería).
// Son plantillas: cada empresa las edita o agrega las suyas. Ver scripts/biblioteca-presupuestos.ts.

export const ITEMS_INICIALES: Array<{ titulo: string; categoria: string; descripcion: string }> = [
  { titulo: 'Desmontaje de techo existente', categoria: 'Desmontajes', descripcion: '<p><b>Desmontaje</b> de techo existente: retiro de chapas, correas y zinguería, con acopio en obra.</p>' },
  { titulo: 'Desmontaje de estructura', categoria: 'Desmontajes', descripcion: '<p><b>Desmontaje</b> de estructura metálica existente y retiro del material.</p>' },
  { titulo: 'Bases de hormigón', categoria: 'Estructura', descripcion: '<p><b>Bases de hormigón</b> armado para columnas, con anclajes y placas de asiento.</p>' },
  { titulo: 'Columnas de perfil C', categoria: 'Estructura', descripcion: '<p><b>Columnas</b> de perfil C de chapa plegada, soldadas en cajón, con placa base y cartelas.</p>' },
  { titulo: 'Columnas de caño estructural', categoria: 'Estructura', descripcion: '<p><b>Columnas</b> de caño estructural, con placa base y anclajes químicos.</p>' },
  { titulo: 'Vigas reticuladas', categoria: 'Estructura', descripcion: '<p><b>Vigas reticuladas</b> de hierro redondo y perfil ángulo, según cálculo.</p>' },
  { titulo: 'Correas de perfil C', categoria: 'Estructura', descripcion: '<p><b>Correas</b> de perfil C galvanizado, con tensores y arriostramientos.</p>' },
  { titulo: 'Techado con chapa trapezoidal', categoria: 'Techado', descripcion: '<p><b>Techado</b> con chapa trapezoidal galvanizada calibre 25, fijada con tornillos autoperforantes con arandela de neoprene.</p>' },
  { titulo: 'Techado con chapa sinusoidal', categoria: 'Techado', descripcion: '<p><b>Techado</b> con chapa sinusoidal galvanizada calibre 25.</p>' },
  { titulo: 'Aislación bajo chapa', categoria: 'Techado', descripcion: '<p><b>Aislación</b> térmica con membrana de espuma de polietileno con aluminio, bajo chapa.</p>' },
  { titulo: 'Canaletas de chapa galvanizada', categoria: 'Zinguería', descripcion: '<p><b>Canaletas</b> de chapa galvanizada calibre 24 con soportes y bajadas.</p>' },
  { titulo: 'Cenefas', categoria: 'Zinguería', descripcion: '<p><b>Cenefas</b> de chapa prepintada en el perímetro del techo.</p>' },
  { titulo: 'Cerramiento lateral con chapa', categoria: 'Cerramientos', descripcion: '<p><b>Cerramiento lateral</b> con chapa trapezoidal sobre estructura de perfiles.</p>' },
  { titulo: 'Portón corredizo', categoria: 'Aberturas', descripcion: '<p><b>Portón corredizo</b> de caño estructural con revestimiento de chapa, guía inferior y rodamientos.</p>' },
  { titulo: 'Rejas', categoria: 'Aberturas', descripcion: '<p><b>Rejas</b> de hierro macizo, con amurado.</p>' },
  { titulo: 'Pintura', categoria: 'Terminaciones', descripcion: '<p><b>Pintura</b>: dos manos de antióxido y dos de esmalte sintético.</p>' },
];

export const OBSERVACIONES_INICIALES: Array<{ texto: string; llevaValor?: boolean; valorSugerido?: string; porDefecto?: boolean }> = [
  { texto: 'Materiales incluidos.', porDefecto: true },
  { texto: 'Materiales no incluidos.' },
  { texto: 'Plazo de obra: {valor}.', llevaValor: true, valorSugerido: '120 días hábiles', porDefecto: true },
  { texto: 'Condición de pago: {valor}.', llevaValor: true, valorSugerido: '15% de anticipo, saldo según avance de obra', porDefecto: true },
  { texto: 'Incluye servicio de {valor}.', llevaValor: true, valorSugerido: 'grúa y autoelevador' },
  { texto: 'El uso de grúa de más de 14 m se cotiza aparte.' },
  { texto: 'Los trabajos adicionales que surjan en obra se cotizan aparte.', porDefecto: true },
  { texto: 'La documentación técnica (planos y cálculo) {valor}.', llevaValor: true, valorSugerido: 'está a cargo del cliente' },
];
