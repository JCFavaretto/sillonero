import { useWindowDimensions } from "react-native";
import { isLandscape } from "./rules";

/** Se actualiza solo al rotar el celu (useWindowDimensions). */
export function useLayout() {
  const { width, height } = useWindowDimensions();
  return { width, height, isLandscape: isLandscape(width, height) };
}
