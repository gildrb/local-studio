import type { DevicePlatformAvailability } from "@t3tools/contracts";
import { Check, Minus } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { buildDeviceHostAvailabilityModel } from "./DeviceHostAvailability.logic";

export function DeviceHostAvailability({
  platforms,
}: {
  platforms: ReadonlyArray<DevicePlatformAvailability>;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {buildDeviceHostAvailabilityModel(platforms).map((item) => (
        <Tooltip key={item.platform}>
          <TooltipTrigger render={<span tabIndex={0} className="inline-flex items-center gap-1" />}>
            {item.available ? <Check className="size-3" /> : <Minus className="size-3" />}
            {item.label}
          </TooltipTrigger>
          <TooltipPopup>{item.tooltip}</TooltipPopup>
        </Tooltip>
      ))}
    </div>
  );
}
