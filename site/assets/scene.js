/*
 * WebsiteTimeTrack — a day, as the extension sees it.
 *
 * The ring is today's time, split by category. The clock in the middle shows
 * your own local time. Click or tap for focus mode: social and entertainment
 * drop back and dim, and an hour starts counting down — what the Focus button
 * in the popup does to those sites.
 */
export default function scene(stage) {
  const { THREE, frame } = stage;
  stage.lights({ ambient: 0.6, key: 2.4 });
  stage.environment(0.9);

  const root = new THREE.Group();
  frame.add(root);
  root.scale.setScalar(0.9);
  root.add(stage.halo(stage.accent, 7.5, 0.26));

  /* -------------------------------------------------------------- ring */

  // An example day. The two marked `leisure` are what focus mode blocks.
  const CATEGORIES = [
    { name: 'Work', share: 0.36, color: '#4c9bff' },
    { name: 'Learning', share: 0.16, color: '#5fe0b0' },
    { name: 'Social', share: 0.2, color: '#ff7eb6', leisure: true },
    { name: 'Entertainment', share: 0.18, color: '#ffb454', leisure: true },
    { name: 'Other', share: 0.1, color: '#8a94a8' },
  ];

  const ring = new THREE.Group();
  root.add(ring);
  const RADIUS = 1.75;
  const GAP = 0.07;
  let angle = Math.PI / 2;
  const segments = CATEGORIES.map((category) => {
    const arc = Math.PI * 2 * category.share - GAP;
    const geometry = new THREE.TorusGeometry(RADIUS, 0.2, 20, Math.max(10, Math.round(90 * category.share)), arc);
    const material = stage.mat.solid(category.color, { roughness: 0.32, metalness: 0.25, transparent: true });
    const mesh = new THREE.Mesh(geometry, material);
    // Clockwise from twelve o'clock, like a clock face.
    mesh.rotation.z = angle - arc;
    const mid = angle - arc / 2;
    angle -= arc + GAP;

    const tag = stage.plate(1.5, 0.3, (g, w, h) => {
      g.fillStyle = category.color;
      g.beginPath();
      g.arc(h * 0.3, h / 2, h * 0.16, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#f2f5f2';
      g.font = stage.font.body(Math.round(h * 0.46), 600);
      g.textBaseline = 'middle';
      g.fillText(category.name, h * 0.62, h * 0.52);
    });
    tag.position.set(Math.cos(mid) * (RADIUS + 0.9) + 0.3, Math.sin(mid) * (RADIUS + 0.5), 0.1);
    ring.add(mesh, tag);
    return { mesh, tag, category, mid, dim: 0 };
  });

  /* ------------------------------------------------------------- clock */

  const face = new THREE.Group();
  root.add(face);
  const tickGeometry = new THREE.BoxGeometry(0.03, 0.12, 0.03);
  const tickMaterial = stage.mat.solid(0xf2f5f2, { emissive: 0xffffff, emissiveIntensity: 0.25 });
  const ticks = new THREE.InstancedMesh(tickGeometry, tickMaterial, 60);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 60; i += 1) {
    const a = (i / 60) * Math.PI * 2;
    const hour = i % 5 === 0;
    dummy.position.set(Math.sin(a) * 1.2, Math.cos(a) * 1.2, 0);
    dummy.rotation.set(0, 0, -a);
    dummy.scale.set(hour ? 1.6 : 0.7, hour ? 1.7 : 0.6, 1);
    dummy.updateMatrix();
    ticks.setMatrixAt(i, dummy.matrix);
  }
  face.add(ticks);

  const hand = (length, width, color) => {
    const pivot = new THREE.Group();
    const mesh = new THREE.Mesh(stage.slab(width, length, 0.04, width / 2), stage.mat.solid(color, { roughness: 0.3 }));
    mesh.position.y = length / 2 - 0.08;
    pivot.add(mesh);
    face.add(pivot);
    return pivot;
  };
  const hours = hand(0.7, 0.085, 0xf2f5f2);
  const minutes = hand(1.02, 0.06, 0xf2f5f2);
  const seconds = hand(1.1, 0.022, stage.accentHi);
  hours.position.z = 0.04;
  minutes.position.z = 0.08;
  seconds.position.z = 0.12;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.12, 24), stage.mat.metal(stage.accentHi));
  cap.rotation.x = Math.PI / 2;
  cap.position.z = 0.12;
  face.add(cap);

  /* ------------------------------------------------------------- focus */

  let focus = 0;
  let focusTarget = 0;
  let focusStart = 0;
  let shown = '';

  const badge = stage.plate(2.6, 0.42, (g, w, h) => {
    if (!shown) return;
    g.fillStyle = 'rgba(5, 8, 6, 0.82)';
    g.beginPath();
    if (g.roundRect) g.roundRect(0, 0, w, h, h / 2);
    else g.rect(0, 0, w, h);
    g.fill();
    g.strokeStyle = `#${stage.accent.getHexString()}`;
    g.lineWidth = h * 0.05;
    g.stroke();
    g.fillStyle = '#f2f5f2';
    g.font = stage.font.mono(Math.round(h * 0.42));
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.fillText(shown, w / 2, h * 0.53);
  });
  badge.position.set(0, -RADIUS - 0.95, 0.3);
  badge.material.opacity = 0;
  root.add(badge);

  stage.onClick(() => {
    focusTarget = focusTarget ? 0 : 1;
    focusStart = stage.time;
  });

  stage.dust({ count: 200, radius: 6.5, color: stage.accentHi, opacity: 0.5 });

  stage.onFrame((time, delta) => {
    root.rotation.y = -0.38 + stage.yaw;
    root.rotation.x = 0.16 + stage.pitch;
    root.position.y = 0.15 + Math.sin(time * 0.7) * 0.05;

    // The visitor's own clock.
    const now = new Date();
    const s = now.getSeconds() + now.getMilliseconds() / 1000;
    const m = now.getMinutes() + s / 60;
    const h = (now.getHours() % 12) + m / 60;
    seconds.rotation.z = -(s / 60) * Math.PI * 2;
    minutes.rotation.z = -(m / 60) * Math.PI * 2;
    hours.rotation.z = -(h / 12) * Math.PI * 2;

    focus += (focusTarget - focus) * Math.min(1, delta * 4);
    for (const segment of segments) {
      const blocked = segment.category.leisure ? focus : 0;
      const breathe = Math.sin(time * 1.1 + segment.mid * 2) * 0.03;
      segment.mesh.position.z = -blocked * 0.55 + breathe;
      segment.mesh.scale.setScalar(1 - blocked * 0.06);
      segment.mesh.material.opacity = 1 - blocked * 0.72;
      segment.tag.material.opacity = 1 - blocked * 0.7;
      segment.tag.position.z = 0.1 - blocked * 0.55;
    }

    // Focus mode counts an hour down while it is on.
    if (focusTarget) {
      const left = Math.max(0, 3600 - Math.floor(stage.time - focusStart));
      const text = `Focus mode · ${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
      if (text !== shown) {
        shown = text;
        badge.userData.redraw();
      }
    }
    badge.material.opacity = focus;
  });
}
