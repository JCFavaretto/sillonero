import { useEffect, useRef } from "react";

/** `ref.current` es false cuando el componente ya se desmontó: sirve para no actuar con una respuesta que llega tarde. */
export function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}
