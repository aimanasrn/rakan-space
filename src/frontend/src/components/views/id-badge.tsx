"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/components/workspace/workspace-context";

// three.js is large: load the 3D lanyard only on the client, after the page.
const Lanyard = dynamic(() => import("@/components/Lanyard"), {
  ssr: false,
  loading: () => <Skeleton className="size-full" />,
});

/** Card face size used by the Lanyard (portrait 1.6 × 2.25). */
const FACE_W = 1024;
const FACE_H = 1440;
const NAVY = "#0f1f3d";
const NAVY_2 = "#1d3a6e";
const ACCENT = "#38bdf8";

interface BadgeImages {
  front: string;
  back: string;
  strap: string;
}

/**
 * The signed-in member's ID card hanging on a lanyard: profile photo, name and
 * job title on the front, the company logo on the back and along the strap.
 */
export function IdBadge() {
  const { me, org } = useWorkspace();
  const [images, setImages] = useState<BadgeImages | null>(null);
  const role = org.membership.role;

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [photo, logo] = await Promise.all([
        loadPrivateImage(me.avatar_url),
        loadPrivateImage(org.logo_url),
      ]);
      const font =
        getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
      const badge = {
        name: me.name,
        title: me.job_title,
        role,
        orgName: org.name,
        website: org.website,
        memberId: me.id,
        photo,
        logo,
        font,
      };
      const next = {
        front: drawFront(badge),
        back: drawBack(badge),
        strap: drawStrap(badge),
      };
      if (alive) setImages(next);
    })();
    return () => {
      alive = false;
    };
  }, [
    me.avatar_url,
    me.name,
    me.job_title,
    me.id,
    org.logo_url,
    org.name,
    org.website,
    role,
  ]);

  return (
    <Card className="relative h-[22rem] gap-0 overflow-hidden bg-linear-to-b from-muted/60 to-background p-0 lg:h-full lg:min-h-[22rem]">
      <p className="sr-only">
        ID card for {me.name}
        {me.job_title ? `, ${me.job_title}` : ""}, {org.name}.
      </p>
      {images ? (
        <Lanyard
          frontImage={images.front}
          backImage={images.back}
          strapImage={images.strap}
          strapColor={NAVY}
          finish="glossy"
          metal="silver"
          size={0.62}
          strapLength={0.45}
          className="absolute inset-0"
        />
      ) : (
        <Skeleton className="absolute inset-0" />
      )}
      <p
        className="pointer-events-none absolute right-0 bottom-2 left-0 text-center text-xs text-muted-foreground"
        aria-hidden
      >
        Drag the card · tap to flip
      </p>
    </Card>
  );
}

// ------------------------------------------------------------------ images

/**
 * Avatars and logos need the session cookie, which a plain <img crossorigin>
 * request does not send. Fetch them with credentials and decode from a blob,
 * so the canvas is never tainted. Returns null when missing or failing.
 */
async function loadPrivateImage(
  url: string | null,
): Promise<HTMLImageElement | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return null;
    const objectUrl = URL.createObjectURL(await res.blob());
    try {
      const img = new Image();
      img.src = objectUrl;
      await img.decode();
      return img;
    } finally {
      // The decoded image keeps its pixels; the blob URL is no longer needed.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    }
  } catch {
    return null;
  }
}

interface Badge {
  name: string;
  title: string | null;
  role: string;
  orgName: string;
  website: string | null;
  memberId: number;
  photo: HTMLImageElement | null;
  logo: HTMLImageElement | null;
  font: string;
}

function canvas(width: number, height: number) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d")!;
  ctx.textBaseline = "middle";
  return { c, ctx };
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    (
      (parts[0]?.[0] ?? "") +
      (parts.length > 1 ? parts[parts.length - 1][0] : "")
    ).toUpperCase() || "?"
  );
}

/** Shrinks the font until the text fits the width. */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  weight: number,
  size: number,
  font: string,
) {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px ${font}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    s -= 2;
  } while (s > 18);
  return s;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Draws an image scaled to cover (or fit inside) a box. */
function drawImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  fit: "cover" | "contain",
) {
  const scale = (fit === "cover" ? Math.max : Math.min)(
    w / img.width,
    h / img.height,
  );
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** The company logo in a white rounded tile, or the company initials when there is no logo. */
function drawLogo(
  ctx: CanvasRenderingContext2D,
  b: Badge,
  x: number,
  y: number,
  size: number,
) {
  ctx.save();
  roundedRect(ctx, x, y, size, size, size * 0.22);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.clip();
  if (b.logo) {
    const pad = size * 0.14;
    drawImage(
      ctx,
      b.logo,
      x + pad,
      y + pad,
      size - pad * 2,
      size - pad * 2,
      "contain",
    );
  } else {
    ctx.fillStyle = NAVY;
    ctx.textAlign = "center";
    ctx.font = `800 ${size * 0.42}px ${b.font}`;
    ctx.fillText(initials(b.orgName), x + size / 2, y + size / 2 + size * 0.03);
  }
  ctx.restore();
}

function drawFront(b: Badge): string {
  const { c, ctx } = canvas(FACE_W, FACE_H);
  const cx = FACE_W / 2;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, FACE_W, FACE_H);

  // Header band (the lanyard slot sits in its top part).
  const bandH = FACE_H * 0.36;
  const band = ctx.createLinearGradient(0, 0, FACE_W, bandH);
  band.addColorStop(0, NAVY);
  band.addColorStop(1, NAVY_2);
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, FACE_W, bandH);
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, bandH - 10, FACE_W, 10);

  // Company logo and name.
  const logoSize = 112;
  ctx.font = `700 46px ${b.font}`;
  const nameSize = fitText(
    ctx,
    b.orgName,
    FACE_W - 160 - logoSize - 28,
    700,
    46,
    b.font,
  );
  const orgWidth = logoSize + 28 + ctx.measureText(b.orgName).width;
  const left = cx - orgWidth / 2;
  drawLogo(ctx, b, left, FACE_H * 0.13, logoSize);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.font = `700 ${nameSize}px ${b.font}`;
  ctx.fillText(b.orgName, left + logoSize + 28, FACE_H * 0.13 + logoSize / 2);

  // Profile photo (or initials) in a ring overlapping the band.
  const r = 230;
  const cy = bandH + 20;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 18, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  if (b.photo) {
    drawImage(ctx, b.photo, cx - r, cy - r, r * 2, r * 2, "cover");
  } else {
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, ACCENT);
    g.addColorStop(1, NAVY_2);
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.font = `700 ${r * 0.8}px ${b.font}`;
    ctx.fillText(initials(b.name), cx, cy + r * 0.05);
  }
  ctx.restore();

  // Name, job title and role.
  ctx.textAlign = "center";
  ctx.fillStyle = "#0f172a";
  const s = fitText(ctx, b.name, FACE_W - 140, 800, 84, b.font);
  ctx.font = `800 ${s}px ${b.font}`;
  ctx.fillText(b.name, cx, FACE_H * 0.69);
  if (b.title) {
    ctx.fillStyle = "#475569";
    const t = fitText(ctx, b.title, FACE_W - 160, 500, 46, b.font);
    ctx.font = `500 ${t}px ${b.font}`;
    ctx.fillText(b.title, cx, FACE_H * 0.745);
  }
  const role = b.role.toUpperCase();
  ctx.font = `700 34px ${b.font}`;
  const pillW = ctx.measureText(role).width + 72;
  roundedRect(ctx, cx - pillW / 2, FACE_H * 0.79, pillW, 64, 32);
  ctx.fillStyle = "#e0f2fe";
  ctx.fill();
  ctx.fillStyle = "#0369a1";
  ctx.fillText(role, cx, FACE_H * 0.79 + 33);

  // Footer: member number and a decorative barcode.
  const footY = FACE_H * 0.885;
  ctx.fillStyle = "#f1f5f9";
  ctx.fillRect(0, footY, FACE_W, FACE_H - footY);
  ctx.fillStyle = "#64748b";
  ctx.textAlign = "left";
  ctx.font = `600 30px ${b.font}`;
  ctx.fillText(
    `ID  ${String(b.memberId).padStart(6, "0")}`,
    80,
    footY + (FACE_H - footY) / 2,
  );
  let seed = b.memberId * 9301 + 49297;
  let x = FACE_W - 80 - 300;
  ctx.fillStyle = "#0f172a";
  while (x < FACE_W - 80) {
    seed = (seed * 9301 + 49297) % 233280;
    const w = 3 + (seed % 4) * 2;
    ctx.fillRect(x, footY + 34, w, FACE_H - footY - 68);
    x += w + 4 + (seed % 3) * 2;
  }

  return c.toDataURL("image/png");
}

function drawBack(b: Badge): string {
  const { c, ctx } = canvas(FACE_W, FACE_H);
  const g = ctx.createLinearGradient(0, 0, FACE_W, FACE_H);
  g.addColorStop(0, NAVY);
  g.addColorStop(1, NAVY_2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, FACE_W, FACE_H);

  // Soft rings for texture.
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 3;
  for (let i = 1; i <= 6; i++) {
    ctx.beginPath();
    ctx.arc(FACE_W / 2, FACE_H * 0.47, 120 + i * 90, 0, Math.PI * 2);
    ctx.stroke();
  }

  const size = 440;
  drawLogo(ctx, b, (FACE_W - size) / 2, FACE_H * 0.47 - size / 2, size);

  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  const s = fitText(ctx, b.orgName, FACE_W - 160, 800, 64, b.font);
  ctx.font = `800 ${s}px ${b.font}`;
  ctx.fillText(b.orgName, FACE_W / 2, FACE_H * 0.74);
  if (b.website) {
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `500 36px ${b.font}`;
    ctx.fillText(
      b.website.replace(/^https?:\/\//, "").replace(/\/$/, ""),
      FACE_W / 2,
      FACE_H * 0.79,
    );
  }
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = `500 28px ${b.font}`;
  ctx.fillText(
    "If found, please return to the office.",
    FACE_W / 2,
    FACE_H * 0.92,
  );

  return c.toDataURL("image/png");
}

/** One repeat of the strap pattern: logo and company name, read along the strap. */
function drawStrap(b: Badge): string {
  const h = 192;
  const w = 960;
  const { c, ctx } = canvas(w, h);
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 10, w, 6);
  ctx.fillRect(0, h - 16, w, 6);

  const logo = 112;
  drawLogo(ctx, b, 48, (h - logo) / 2, logo);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  const s = fitText(
    ctx,
    b.orgName.toUpperCase(),
    w - 48 - logo - 40 - 60,
    800,
    56,
    b.font,
  );
  ctx.font = `800 ${s}px ${b.font}`;
  ctx.fillText(b.orgName.toUpperCase(), 48 + logo + 40, h / 2 + 2);

  return c.toDataURL("image/png");
}
