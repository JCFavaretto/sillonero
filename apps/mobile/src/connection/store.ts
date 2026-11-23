import { create } from "zustand";
import { initialState, type ConnState } from "./machine";

/** Solo escribe `client`; las pantallas leen con selectores: `useConn((s) => s.status)`. */
export const useConn = create<ConnState>()(() => initialState);
