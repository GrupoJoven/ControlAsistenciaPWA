// components/GloriiMateoBirthdaySplash.tsx
// Pantalla de bienvenida TEMPORAL por el cumpleaños de La Glorii y Mateo.
// Solo se muestra el día BIRTHDAY_DATE (fecha local del dispositivo), cada vez
// que se abre la app y antes que cualquier otra cosa (también antes del login).
// Cualquier otro día no renderiza nada. Para quitarla del todo: borrar este
// archivo, public/cumple-glorii-mateo-1.jpg, public/cumple-glorii-mateo-2.png
// y su uso en index.tsx.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { PartyPopper, X } from "lucide-react";
import { getTodayStr } from "../types";

const BIRTHDAY_DATE = "2026-11-16";
const MESSAGE = "¡Feliz cumpleaños La Glorii y Mateo!";

const PHOTOS = [
  {
    src: "/cumple-glorii-mateo-1.jpg",
    alt: "Foto de cumpleaños de La Glorii y Mateo (1)",
    width: 920,
    height: 1342,
    // Alto relativo al hueco disponible y giro fijo, para que parezcan dos
    // fotos dejadas una al lado de la otra. heightFraction debe coincidir con
    // heightClass (Tailwind necesita la clase escrita entera).
    heightFraction: 1,
    heightClass: "h-full",
    tilt: -3.5,
    floatDelay: "0s",
  },
  {
    src: "/cumple-glorii-mateo-2.png",
    alt: "Foto de cumpleaños de La Glorii y Mateo (2)",
    width: 496,
    height: 503,
    heightFraction: 0.78,
    heightClass: "h-[78%]",
    tilt: 3.5,
    floatDelay: "-1.6s",
  },
];

// Ancho total que ocupan las dos fotos por cada 1 de alto del hueco.
const PHOTOS_WIDTH_RATIO = PHOTOS.reduce(
  (total, photo) => total + (photo.heightFraction * photo.width) / photo.height,
  0
);

const CONFETTI_COLORS = ["#f472b6", "#facc15", "#60a5fa", "#34d399", "#a78bfa", "#fb923c", "#f87171", "#ffffff"];
const NAME_COLORS = ["#facc15", "#f472b6", "#60a5fa", "#34d399", "#fb923c", "#a78bfa", "#f87171"];

// Las animaciones viven aquí (y no en tailwind.config.js / index.css) para que
// quitar la pantalla sea borrar un único componente.
const STYLES = `
@keyframes cumple-bg { 0%, 100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
@keyframes cumple-fall { from { transform: translate3d(0, -12vh, 0) rotate(0deg); } to { transform: translate3d(var(--dx), 112vh, 0) rotate(var(--rot)); } }
@keyframes cumple-flutter { 0%, 100% { transform: rotateY(0deg); } 50% { transform: rotateY(180deg); } }
@keyframes cumple-rise { 0% { transform: translate3d(0, 0, 0); opacity: 0; } 8% { opacity: 1; } 100% { transform: translate3d(var(--dx), -125vh, 0); opacity: 1; } }
@keyframes cumple-drop { 0% { opacity: 0; transform: translateY(-140%) scale(.4) rotate(-25deg); } 60% { opacity: 1; transform: translateY(10%) scale(1.15) rotate(6deg); } 100% { opacity: 1; transform: none; } }
@keyframes cumple-wave { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-16%); } }
@keyframes cumple-pop { 0% { opacity: 0; transform: scale(.5) rotate(-12deg); } 70% { opacity: 1; transform: scale(1.05); } 100% { opacity: 1; transform: none; } }
@keyframes cumple-float { 0%, 100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-10px) rotate(1.5deg); } }
@keyframes cumple-spin { to { transform: rotate(360deg); } }
@keyframes cumple-twinkle { 0%, 100% { opacity: .25; transform: scale(.6); } 50% { opacity: 1; transform: scale(1.2); } }
@keyframes cumple-glow { 0%, 100% { box-shadow: 0 0 0 0 rgba(250, 204, 21, .55); } 50% { box-shadow: 0 0 0 14px rgba(250, 204, 21, 0); } }

.cumple-bg {
  background: linear-gradient(120deg, #1e1b4b, #581c87, #9d174d, #1e3a8a, #4c1d95);
  background-size: 400% 400%;
  animation: cumple-bg 14s ease infinite;
}
.cumple-confetti { position: absolute; top: 0; animation: cumple-fall linear infinite; }
.cumple-confetti > span { display: block; animation: cumple-flutter ease-in-out infinite; }
.cumple-balloon { position: absolute; top: 100%; animation: cumple-rise linear infinite; }
.cumple-letter { display: inline-block; animation: cumple-drop .8s cubic-bezier(.2, .9, .3, 1.3) both, cumple-wave 2.2s ease-in-out infinite; }
.cumple-pop { animation: cumple-pop .9s cubic-bezier(.2, .9, .3, 1.2) .6s both; }
.cumple-float { animation: cumple-float 4s ease-in-out infinite; }
.cumple-halo { animation: cumple-spin 7s linear infinite; }
.cumple-twinkle { animation: cumple-twinkle 1.8s ease-in-out infinite; }
.cumple-cta { animation: cumple-pop .7s cubic-bezier(.2, .9, .3, 1.2) 1.4s both, cumple-glow 1.8s ease-out 2.2s infinite; }

/* Sin movimiento: el confeti se queda quieto repartido por la pantalla */
@media (prefers-reduced-motion: reduce) {
  .cumple-bg, .cumple-letter, .cumple-pop, .cumple-float, .cumple-halo, .cumple-twinkle, .cumple-cta,
  .cumple-confetti, .cumple-confetti > span { animation: none !important; }
  .cumple-confetti { transform: translate3d(0, var(--y), 0) rotate(var(--rot)); }
  .cumple-balloon { display: none; }
}
`;

const rand = (min: number, max: number) => min + Math.random() * (max - min);

// Cada letra cae por separado y luego "ondea" en bucle, desfasada respecto a la
// anterior. Las palabras van agrupadas para que el salto de línea (los nombres
// son largos) caiga siempre en un espacio y nunca parta una palabra.
const renderLetters = (text: string, startDelay: number, colors?: string[]) => {
  let index = 0;
  return text.split(" ").map((word, w) => (
    <React.Fragment key={w}>
      {w > 0 ? " " : null}
      <span className="inline-block whitespace-nowrap">
        {Array.from(word).map((ch, i) => {
          const delay = startDelay + index * 0.06;
          const color = colors ? colors[index % colors.length] : undefined;
          index += 1;
          return (
            <span
              key={i}
              className="cumple-letter"
              style={{ animationDelay: `${delay}s, ${delay + 1.2}s`, color }}
            >
              {ch}
            </span>
          );
        })}
      </span>
    </React.Fragment>
  ));
};

const GloriiMateoBirthdaySplash: React.FC = () => {
  const [visible, setVisible] = useState(() => getTodayStr() === BIRTHDAY_DATE);
  const [closing, setClosing] = useState(false);

  // Retrasos negativos para que el confeti ya esté repartido por la pantalla al abrir.
  const confetti = useMemo(
    () =>
      Array.from({ length: 80 }, (_, i) => {
        const duration = rand(5, 10);
        return {
          id: i,
          left: rand(0, 100),
          y: rand(0, 100),
          duration,
          delay: -rand(0, duration),
          flutter: rand(0.6, 1.6),
          dx: rand(-15, 15),
          rot: rand(360, 1080) * (Math.random() < 0.5 ? -1 : 1),
          width: rand(6, 11),
          round: Math.random() < 0.3,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        };
      }),
    []
  );

  const balloons = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => ({
        id: i,
        // Globos en los laterales para no tapar el mensaje ni las fotos
        left: i % 2 === 0 ? rand(1, 14) : rand(84, 95),
        duration: rand(9, 15),
        delay: -rand(0, 12),
        dx: rand(-6, 6),
        hue: Math.round(rand(0, 360)),
        size: rand(2.2, 3.6),
      })),
    []
  );

  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(() => setVisible(false), 450);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    // Que la pantalla de detrás (login o app) no haga scroll ni asome su barra
    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = prevOverflow;
    };
  }, [visible, close]);

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={MESSAGE}
      className={`cumple-bg fixed inset-0 z-[200] overflow-hidden text-white transition-opacity duration-500 ${
        closing ? "opacity-0" : "opacity-100"
      }`}
    >
      <style>{STYLES}</style>

      {/* confeti */}
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ perspective: "600px" }}>
        {confetti.map(c => (
          <div
            key={c.id}
            className="cumple-confetti"
            style={{
              left: `${c.left}%`,
              animationDuration: `${c.duration}s`,
              animationDelay: `${c.delay}s`,
              ["--dx" as string]: `${c.dx}vw`,
              ["--y" as string]: `${c.y}vh`,
              ["--rot" as string]: `${c.rot}deg`,
            }}
          >
            <span
              style={{
                width: c.width,
                height: c.round ? c.width : c.width * 1.6,
                borderRadius: c.round ? "9999px" : "2px",
                background: c.color,
                animationDuration: `${c.flutter}s`,
              }}
            />
          </div>
        ))}
      </div>

      {/* globos */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {balloons.map(b => (
          <div
            key={b.id}
            className="cumple-balloon"
            style={{
              left: `${b.left}%`,
              fontSize: `${b.size}rem`,
              filter: `hue-rotate(${b.hue}deg) drop-shadow(0 6px 10px rgba(0,0,0,.3))`,
              animationDuration: `${b.duration}s`,
              animationDelay: `${b.delay}s`,
              ["--dx" as string]: `${b.dx}vw`,
            }}
          >
            🎈
          </div>
        ))}
      </div>

      <button
        onClick={close}
        className="absolute right-3 top-3 z-10 rounded-full bg-white/10 p-2.5 text-white/80 backdrop-blur hover:bg-white/20 hover:text-white transition-colors"
        aria-label="Cerrar"
        title="Cerrar"
      >
        <X size={20} />
      </button>

      <div className="relative flex h-full flex-col items-center justify-center gap-4 px-4 pb-6 pt-10 sm:gap-6 sm:pb-8 sm:pt-12">
        {/* mensaje */}
        <div className="shrink-0 text-center">
          <div className="cumple-pop mb-3 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-amber-200 backdrop-blur sm:text-sm" style={{ animationDelay: "0s" }}>
            <PartyPopper size={16} />
            Hoy es un día muy especial
            <PartyPopper size={16} className="-scale-x-100" />
          </div>

          <h1 aria-label={MESSAGE} className="font-black leading-[1.05] tracking-tight">
            <span
              aria-hidden
              className="block"
              style={{
                // Los nombres son largos: el tamaño baja con el ancho y también
                // con el alto, para que en una pantalla apaisada y baja el
                // título no se coma el hueco de las fotos.
                fontSize: "clamp(1.75rem, min(7vw, 9vh), 3.75rem)",
                textShadow: "0 4px 0 rgba(0,0,0,.25), 0 0 28px rgba(255,255,255,.35)",
              }}
            >
              {renderLetters("¡Feliz cumpleaños", 0.2)}
            </span>
            <span
              aria-hidden
              className="mt-1 block"
              style={{
                fontSize: "clamp(2rem, min(9vw, 12vh), 4.5rem)",
                textShadow: "0 5px 0 rgba(0,0,0,.3), 0 0 32px currentColor",
              }}
            >
              {renderLetters("La Glorii y Mateo!", 1.2, NAME_COLORS)}
            </span>
          </h1>
        </div>

        {/* fotos */}
        {/* El alto manda sobre el tamaño de las fotos (cada una lo convierte en
            ancho con su proporción), así que en pantallas estrechas hay que
            limitarlo o las dos juntas se salen de lado. PHOTOS_WIDTH_RATIO es
            lo que miden de ancho las dos sumadas por cada 1 de alto. */}
        <div
          className="relative flex min-h-0 w-full flex-1 items-center justify-center gap-3 sm:gap-6"
          style={{ maxHeight: `calc((100vw - 3.5rem) / ${PHOTOS_WIDTH_RATIO})` }}
        >
          {PHOTOS.map((photo, i) => (
            <div
              key={photo.src}
              className={`relative ${photo.heightClass} max-h-[720px]`}
              style={{ transform: `rotate(${photo.tilt}deg)` }}
            >
              <div className="cumple-pop relative h-full" style={{ animationDelay: `${0.9 + i * 0.25}s` }}>
                <div className="cumple-float relative h-full" style={{ animationDelay: photo.floatDelay }}>
                  <div
                    aria-hidden
                    className="cumple-halo absolute -inset-4 rounded-full opacity-80 blur-2xl"
                    style={{ background: "conic-gradient(from 0deg, #f472b6, #facc15, #34d399, #60a5fa, #a78bfa, #f472b6)" }}
                  />
                  <div
                    className="relative h-full rounded-[1.6rem] bg-white p-2 shadow-2xl sm:p-2.5"
                    style={{ aspectRatio: `${photo.width} / ${photo.height}` }}
                  >
                    <img
                      src={photo.src}
                      alt={photo.alt}
                      width={photo.width}
                      height={photo.height}
                      className="h-full w-full rounded-[1.2rem] object-cover"
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}

          <span aria-hidden className="cumple-twinkle absolute left-[2%] top-[6%] text-2xl sm:text-3xl">✨</span>
          <span aria-hidden className="cumple-twinkle absolute right-[3%] top-[22%] text-2xl sm:text-3xl" style={{ animationDelay: ".6s" }}>⭐</span>
          <span aria-hidden className="cumple-twinkle absolute left-[4%] bottom-[18%] text-2xl sm:text-3xl" style={{ animationDelay: "1.1s" }}>🎉</span>
          <span aria-hidden className="cumple-twinkle absolute right-[2%] bottom-[5%] text-2xl sm:text-3xl" style={{ animationDelay: ".3s" }}>🎂</span>
          <span aria-hidden className="cumple-twinkle absolute left-1/2 top-[2%] -translate-x-1/2 text-2xl sm:text-3xl" style={{ animationDelay: ".9s" }}>🎁</span>
        </div>

        <button
          onClick={close}
          autoFocus
          className="cumple-cta shrink-0 rounded-2xl bg-amber-400 px-7 py-3.5 text-base font-extrabold text-slate-900 shadow-lg hover:bg-amber-300 transition-colors sm:text-lg"
        >
          Entrar en la app 🎉
        </button>
      </div>
    </div>
  );
};

export default GloriiMateoBirthdaySplash;
