"use client";

import { useEffect, useRef, useState } from "react";

// A flowing aurora drawn by one fragment shader: domain-warped noise mixed
// between the three brand colours, masked to a glow behind the headline.
// No library, a few KB, and it stops rendering when off screen or hidden.

const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.0,1.0);}`;

const FRAG = `precision mediump float;
uniform vec2 u_res;uniform float u_time;uniform vec3 u_c1;uniform vec3 u_c2;uniform vec3 u_c3;uniform float u_alpha;
vec2 hash(vec2 p){p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));return -1.0+2.0*fract(sin(p)*43758.5453);}
float noise(vec2 p){const float K1=0.366025404;const float K2=0.211324865;vec2 i=floor(p+(p.x+p.y)*K1);vec2 a=p-i+(i.x+i.y)*K2;float m=step(a.y,a.x);vec2 o=vec2(m,1.0-m);vec2 b=a-o+K2;vec2 c=a-1.0+2.0*K2;vec3 h=max(0.5-vec3(dot(a,a),dot(b,b),dot(c,c)),0.0);vec3 n=h*h*h*h*vec3(dot(a,hash(i)),dot(b,hash(i+o)),dot(c,hash(i+1.0)));return dot(n,vec3(70.0));}
float fbm(vec2 p){float f=0.0;float a=0.5;for(int i=0;i<3;i++){f+=a*noise(p);p*=1.9;a*=0.5;}return f;}
void main(){
vec2 uv=gl_FragCoord.xy/u_res;
vec2 p=(gl_FragCoord.xy-0.5*u_res)/u_res.y;
float t=u_time*0.03;
vec2 p0=p*0.55;
vec2 q=vec2(fbm(p0+vec2(0.0,t)),fbm(p0+vec2(5.2,1.3)-t));
vec2 r=vec2(fbm(p0+1.2*q+vec2(1.7,9.2)+0.6*t),fbm(p0+1.2*q+vec2(8.3,2.8)-0.4*t));
float f=fbm(p0+1.4*r);
vec3 col=mix(u_c1,u_c2,smoothstep(-0.45,0.55,f));
col=mix(col,u_c3,smoothstep(0.25,0.95,length(q)));
vec2 g=(p-vec2(0.0,0.24))*vec2(0.62,1.35);
float mask=exp(-dot(g,g)*5.5);
float band=smoothstep(0.05,0.65,uv.y);
float a=clamp(mask*band*(0.35+0.65*smoothstep(-0.35,0.65,f))*u_alpha,0.0,1.0);
gl_FragColor=vec4(col*a,a);
}`;

function cssColor(name: string): [number, number, number] {
  const hex = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
    .replace("#", "");
  const v = parseInt(hex.length === 3 ? hex.replace(/./g, "$&$&") : hex, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
}

export function Aurora({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", {
      premultipliedAlpha: true,
      alpha: true,
      antialias: false,
    });
    const vs = gl && compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = gl && compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl && vs && fs ? gl.createProgram() : null;
    if (!gl || !prog || !vs || !fs) {
      setFallback(true);
      return;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      setFallback(true);
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const u = (n: string) => gl.getUniformLocation(prog, n);
    const uRes = u("u_res"),
      uTime = u("u_time"),
      uAlpha = u("u_alpha");
    const uC = [u("u_c1"), u("u_c2"), u("u_c3")];

    function applyTheme() {
      const light = document.documentElement.dataset.theme === "light";
      ["--raw-grad-1", "--raw-grad-2", "--raw-grad-3"].forEach((v, i) =>
        gl!.uniform3fv(uC[i] ?? null, cssColor(v)),
      );
      gl!.uniform1f(uAlpha, light ? 0.3 : 0.55);
    }
    applyTheme();

    function resize() {
      // Half resolution: the field is soft by design, so this costs nothing visually.
      const dpr = 0.5;
      const w = Math.max(1, Math.floor(canvas!.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas!.clientHeight * dpr));
      if (canvas!.width !== w || canvas!.height !== h) {
        canvas!.width = w;
        canvas!.height = h;
        gl!.viewport(0, 0, w, h);
        gl!.uniform2f(uRes, w, h);
      }
    }

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now() - 40_000; // start mid-flow, not from a blank frame
    let raf = 0;
    let visible = true;

    function frame(now: number) {
      resize();
      gl!.uniform1f(uTime, (now - start) / 1000);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      if (!still && visible && !document.hidden) raf = requestAnimationFrame(frame);
    }
    const kick = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    };

    const io = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? false;
      if (visible) kick();
    });
    io.observe(canvas);
    const ro = new ResizeObserver(kick);
    ro.observe(canvas);
    const mo = new MutationObserver(() => {
      applyTheme();
      kick();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    document.addEventListener("visibilitychange", kick);
    kick();

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      mo.disconnect();
      document.removeEventListener("visibilitychange", kick);
    };
  }, []);

  if (fallback) {
    return (
      <div
        aria-hidden="true"
        className={`bg-[radial-gradient(ellipse_60%_45%_at_50%_30%,color-mix(in_srgb,var(--raw-grad-2)_22%,transparent),transparent_70%)] ${className}`}
      />
    );
  }
  return <canvas ref={ref} aria-hidden="true" className={className} />;
}
