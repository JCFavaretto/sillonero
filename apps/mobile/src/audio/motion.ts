import { Easing } from "react-native-reanimated";

// Ingredientes de movimiento del reproductor (skills de movimiento, 08/11/2026). Nada de curvas inventadas.

/** Salida fuerte para lo que entra o se acomoda: arranca rápido y aterriza suave. */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/** Duraciones en ms: apretar un botón, cambio de estado (silencio), cambio de contenido o de lugar. */
export const DUR = { press: 120, state: 160, base: 220 } as const;

/** Resorte seco para apretar (sin rebote: es un botón, no un juguete). */
export const PRESS_SPRING = { damping: 18, stiffness: 420, mass: 0.6 } as const;
