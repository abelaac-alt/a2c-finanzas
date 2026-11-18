import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({ frame, fps, config: { damping: 200 } });
  const opacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "#0f172a", justifyContent: "center", alignItems: "center" }}>
      <div style={{ color: "white", fontSize: 120, fontWeight: 700, fontFamily: "sans-serif", opacity, transform: `scale(${scale})` }}>
        A2C Finanzas
      </div>
    </AbsoluteFill>
  );
};
