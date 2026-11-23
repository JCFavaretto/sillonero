import type { Zone } from "@proyecto-e/protocol";
import { ZoneThumb } from "@/components/ZonePicker";

/** La miniatura chica de la zona de un paso (en la lista del editor). */
export function PlacePickerSummary({ zone }: { zone: Zone }) {
  return <ZoneThumb zone={zone} width={40} height={26} />;
}
