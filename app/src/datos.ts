// Datos de ejemplo fijos: todavía no hay agentes ni backend.

type Acento = "turquesa" | "naranja" | "violeta" | "azul" | "rojizo";
type Glifo = "buscar" | "pluma" | "grafica" | "sobre" | "lista";

interface Empleado { id: string; nombre: string; rol: string; acento: Acento; glifo: Glifo }
interface Check { etiqueta: string; detalle: string }
type Mensaje =
  | { separador: string }
  | { de: string; texto?: string; checks?: Check[]; reaccion?: string }; // de: "yo" o id de empleado

interface Conversacion { id: string; nombre: string; miembros: string[]; hora: string; noLeido: boolean; mensajes: Mensaje[] }

const USUARIO = { nombre: "Disca", iniciales: "D" };

const EMPLEADOS: Empleado[] = [
  { id: "lucia", nombre: "Lucía", rol: "investigadora", acento: "turquesa", glifo: "buscar" },
  { id: "mateo", nombre: "Mateo", rol: "redactor", acento: "naranja", glifo: "pluma" },
  { id: "valeria", nombre: "Valeria", rol: "analista", acento: "violeta", glifo: "grafica" },
  { id: "tomas", nombre: "Tomás", rol: "asistente de correo", acento: "azul", glifo: "sobre" },
  { id: "ines", nombre: "Inés", rol: "organizadora", acento: "rojizo", glifo: "lista" },
];

const CONVERSACIONES: Conversacion[] = [
  {
    id: "equipo", nombre: "Equipo", miembros: ["lucia", "mateo", "valeria"], hora: "10:42", noLeido: true,
    mensajes: [
      { separador: "Hoy 10:30 AM" },
      { de: "yo", texto: "lucía, investiga opciones de paneles solares para una casa pequeña. mateo, cuando termine, resúmelo en una página." },
      { de: "lucia", texto: "entendido. empiezo por precios y rendimiento, te aviso en cada paso." },
      { de: "lucia", checks: [
        { etiqueta: "Fuentes", detalle: "6 sitios revisados" },
        { etiqueta: "Informe", detalle: "paneles-solares.md" },
      ] },
      { de: "lucia", texto: "listo. mateo, te dejé el informe en el hilo." },
      { de: "mateo", texto: "lo tengo. ¿lo quieres en tono formal o casual?" },
    ],
  },
  {
    id: "lucia", nombre: "Lucía", miembros: ["lucia"], hora: "10:15", noLeido: false,
    mensajes: [
      { separador: "Ayer 6:05 PM" },
      { de: "yo", texto: "¿qué dicen las noticias sobre el precio de la memoria ram este mes?" },
      { de: "lucia", texto: "revisé cuatro fuentes. en resumen: subió cerca de un 10% y se espera que siga estable." },
      { separador: "Hoy 10:15 AM" },
      { de: "yo", texto: "perfecto, gracias", reaccion: "👍" },
    ],
  },
  {
    id: "mateo", nombre: "Mateo", miembros: ["mateo"], hora: "9:50", noLeido: false,
    mensajes: [
      { separador: "Hoy 9:40 AM" },
      { de: "yo", texto: "escribe un borrador de anuncio para el lanzamiento, corto." },
      { de: "mateo", texto: "aquí va una primera versión de tres párrafos. dime si ajusto el tono." },
      { de: "mateo", checks: [
        { etiqueta: "Borrador", detalle: "anuncio-v1.md" },
        { etiqueta: "Largo", detalle: "180 palabras" },
      ] },
      { de: "yo", texto: "me gusta, déjalo así", reaccion: "❤️" },
    ],
  },
  {
    id: "valeria", nombre: "Valeria", miembros: ["valeria"], hora: "Ayer", noLeido: true,
    mensajes: [
      { separador: "Ayer 4:20 PM" },
      { de: "yo", texto: "revisa la hoja de gastos y dime dónde se fue más dinero." },
      { de: "valeria", texto: "la mayor parte fue a transporte: 38% del total." },
      { de: "valeria", texto: "tengo una duda antes de seguir: ¿cuento los reembolsos como ingreso o los descuento del gasto?" },
    ],
  },
  {
    id: "tomas", nombre: "Tomás", miembros: ["tomas"], hora: "Ayer", noLeido: false,
    mensajes: [
      { separador: "Ayer 11:02 AM" },
      { de: "yo", texto: "prepara respuestas para los correos pendientes, pero no envíes nada." },
      { de: "tomas", checks: [
        { etiqueta: "Borradores", detalle: "3 respuestas listas" },
        { etiqueta: "Enviados", detalle: "ninguno, esperan tu aprobación" },
      ] },
      { de: "tomas", texto: "cuando quieras los revisamos uno por uno." },
    ],
  },
  {
    id: "ines", nombre: "Inés", miembros: ["ines"], hora: "Lun", noLeido: false,
    mensajes: [
      { separador: "Lunes 8:30 AM" },
      { de: "yo", texto: "ordena las tareas de la semana por prioridad." },
      { de: "ines", texto: "hecho. dejé cinco tareas: dos urgentes arriba y el resto por fecha." },
      { de: "ines", checks: [
        { etiqueta: "Urgentes", detalle: "2" },
        { etiqueta: "Archivo", detalle: "semana.md" },
      ] },
    ],
  },
];
