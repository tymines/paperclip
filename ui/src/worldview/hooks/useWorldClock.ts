/** World View  clocks (TYL-131). ZULU (UTC) + local, ticking each second. */
import { useEffect, useState } from "react";

export function useWorldClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const zulu = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(now);

  const local = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", month: "short", day: "2-digit",
    hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short",
  }).format(now).toUpperCase();

  return { zulu: `${zulu}Z`, local, now };
}
