import { InputHTMLAttributes, useEffect, useRef } from "react";

export function BotNumberInput(
  props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">,
) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    const preventWheelChange = (event: WheelEvent) => {
      if (document.activeElement === input) event.preventDefault();
    };
    // React wheel handlers are passive; a native listener can cancel stepping
    // without blurring the field or interrupting keyboard input.
    input.addEventListener("wheel", preventWheelChange, { passive: false });
    return () => input.removeEventListener("wheel", preventWheelChange);
  }, []);

  return <input {...props} ref={ref} type="number" />;
}
