/** ¿Estamos en la demo ("Ver demo")? Las acciones de audio se aplican local en vez de mandarse a la PC. */
let on = false;
export const isAudioDemo = (): boolean => on;
export const setAudioDemo = (v: boolean): void => void (on = v);
