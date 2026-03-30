/**
 * landscape.js — Three.js panoramic alpine landscape for Breathing Verbier
 *
 * Renders a bright daytime Verbier-inspired alpine scene: layered mountain
 * silhouettes with snow caps, gradient blue sky, scattered clouds, a church
 * silhouette, and floating performance entities positioned via UMAP.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PALETTE, TERRAIN, CAMERA, ENTITY } from '../shared/constants.js';
import { createPerformanceEntity } from './performance-entity.js';
import { AudioPreviewPlayer } from './audio-preview.js';

let scene, camera, renderer, controls, clock;
let entities = [], particles, mountainGroups = [];
let audioPreview;
let hoveredEntity = null;
let callbacks = {};
let animFrameId = null;
let isActive = false;
let timeMachineActive = false;
let currentYear = 'All';

// ============================================================
// Noise utility
// ============================================================
function noise2D(x, y) {
    // Continuous smooth noise composite to prevent spiky "sticks"
    const n = Math.sin(x) * Math.cos(y) + 
              0.5 * Math.sin(x * 2.3 + y * 1.5) + 
              0.25 * Math.cos(x * 4.1 - y * 3.3);
    return n / 1.75;
}

function fbm(x, y, octaves = 4) {
    let val = 0, amp = 1, freq = 1;
    for (let i = 0; i < octaves; i++) {
        val += amp * noise2D(x * freq, y * freq);
        amp *= 0.5;
        freq *= 2;
    }
    return val;
}

// ============================================================
// Terrain (True 3D Math)
// ============================================================
function getWorldHeightAt(wx, wz) {
    const distToCenter = Math.sqrt(wx * wx + wz * wz);
    
    let h = 0;
    
    // Broad, smooth mountains using positive noise
    let n1 = (fbm(wx * 0.01, wz * 0.01, 3) + 1.0) * 0.5; // Approx [0, 1]
    h += Math.pow(n1, 2.0) * 30; // Square the noise for wider valleys, softer peaks
    
    // Medium rolling hills
    let n2 = (fbm(wx * 0.025, wz * 0.025, 2) + 1.0) * 0.5;
    h += n2 * 8;
    
    // Subtle detail
    let n3 = (fbm(wx * 0.08, wz * 0.08, 1) + 1.0) * 0.5;
    h += n3 * 2;
    
    // Base bowl shape ensures the far edges form mountains
    h += (distToCenter * distToCenter) * 0.0015;
    
    // Flatten center deeply to create a stage without an ugly harsh clamp
    if (distToCenter < 70) {
        let t = distToCenter / 70;
        let smoothFactor = t * t * (3 - 2 * t); // smoothstep
        h *= smoothFactor;
    }
    
    return h - 5;
}

function createTerrain() {
    const size = 600;
    const res = 250;
    const geo = new THREE.PlaneGeometry(size, size, res, res);
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    
    const cDeepGreen = new THREE.Color('#2e4a2e'); // deep forest shaded green
    const cGrass = new THREE.Color('#82c94a'); // very bright, vibrant spring green hills
    const cRock = new THREE.Color('#9fb5a7'); // greenish-gray rocks
    const cSnow = new THREE.Color('#ffffff'); // pure white snow
    
    for (let i = 0; i < pos.count; i++) {
        const lx = pos.getX(i);
        const ly = pos.getY(i);
        const wx = lx;
        const wz = -ly; 
        
        const h = getWorldHeightAt(wx, wz);
        pos.setZ(i, h + 5); // Z is height for unrotated plane
        
        let c = new THREE.Color();
        if (h < 5) c.lerpColors(cDeepGreen, cGrass, (h + 5) / 10);
        else if (h < 25) c.lerpColors(cGrass, cRock, (h - 5) / 20);
        else if (h < 40) c.lerpColors(cRock, cSnow, (h - 25) / 15);
        else c.copy(cSnow);
        
        // Add random variation
        c.offsetHSL(0, 0, (Math.random() - 0.5) * 0.05);
        
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
    }
    
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    
    const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.85,
        metalness: 0.05,
        side: THREE.FrontSide
    });
    
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -5;
    mesh.receiveShadow = true;
    return mesh;
}

// ============================================================
// 3D Church Model
// ============================================================
function createChurch(x, z, scale = 1) {
    const group = new THREE.Group();
    const color = 0xdad1c1;
    const roofColor = 0x6b3a2a;
    
    const bodyGeo = new THREE.BoxGeometry(3 * scale, 4 * scale, 5 * scale);
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.set(0, 2 * scale, 0);
    body.castShadow = true; body.receiveShadow = true;
    group.add(body);
    
    const roofGeo = new THREE.ConeGeometry(2.5 * scale, 2.5 * scale, 4);
    const roofMat = new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.8 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.rotation.y = Math.PI / 4;
    roof.position.set(0, 4 * scale + (1.25 * scale), 0);
    roof.castShadow = true; roof.receiveShadow = true;
    group.add(roof);
    
    const towerGeo = new THREE.BoxGeometry(2 * scale, 8 * scale, 2 * scale);
    const tower = new THREE.Mesh(towerGeo, bodyMat);
    tower.position.set(0, 4 * scale, 3.5 * scale);
    tower.castShadow = true; tower.receiveShadow = true;
    group.add(tower);
    
    const steepleGeo = new THREE.ConeGeometry(1.5 * scale, 4 * scale, 4);
    const steeple = new THREE.Mesh(steepleGeo, roofMat);
    steeple.rotation.y = Math.PI / 4;
    steeple.position.set(0, 10 * scale, 3.5 * scale);
    steeple.castShadow = true; steeple.receiveShadow = true;
    group.add(steeple);
    
    group.position.set(x, getWorldHeightAt(x, z), z);
    return group;
}

// ============================================================
// Sky Sphere 
// ============================================================
function createSkySphere() {
    const geo = new THREE.SphereGeometry(600, 32, 16); // Increased to avoid clipping
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    
    const skyTop = new THREE.Color('#0a7edb'); // vibrant bright blue zenith
    const skyBottom = new THREE.Color('#b4e7ff'); // glowing cyan horizon
    
    for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const t = Math.max(0, Math.min(1, (y + 100) / 400));
        let c = skyBottom.clone().lerp(skyTop, t);
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
    }
    
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false });
    return new THREE.Mesh(geo, mat);
}

// ============================================================
// 3D Clouds
// ============================================================
function createClouds() {
    const group = new THREE.Group();
    for (let c = 0; c < 30; c++) {
        const r = 50 + Math.random() * 200;
        const theta = Math.random() * Math.PI * 2;
        const x = Math.cos(theta) * r;
        const z = Math.sin(theta) * r;
        const y = 35 + Math.random() * 35;
        
        const cloudBase = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({
            color: 0xffffff, // crisp white clouds
            transparent: true,
            opacity: 0.5,
            roughness: 1.0,
            depthWrite: false
        });
        
        for (let i = 0; i < 4; i++) {
            const size = 10 + Math.random() * 15;
            const geo = new THREE.SphereGeometry(size, 8, 8);
            const puff = new THREE.Mesh(geo, mat);
            puff.position.set((Math.random()-0.5)*15, (Math.random()-0.5)*8, (Math.random()-0.5)*15);
            puff.scale.set(1, 0.4 + Math.random()*0.3, 0.8 + Math.random()*0.4);
            cloudBase.add(puff);
        }
        
        cloudBase.position.set(x, y, z);
        cloudBase.userData.cloudDrift = {
            speed: 0.05 + Math.random() * 0.05,
            thetaBase: theta,
            r: r
        };
        group.add(cloudBase);
    }
    return group;
}

// ============================================================
// 3D Pine Trees
// ============================================================
function createPineTrees() {
    const group = new THREE.Group();
    const treeCount = 8; // Very sparse trees for minimalist 3D look
    
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.4, 1, 5);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a }); // natural brown
    
    const canopyGeo1 = new THREE.ConeGeometry(1.5, 2.5, 6);
    const canopyGeo2 = new THREE.ConeGeometry(1.2, 2.0, 6);
    const canopyGeo3 = new THREE.ConeGeometry(0.8, 1.5, 6);
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x1e3a1e, roughness: 0.9 }); // deep dark forest green
    
    for (let i = 0; i < treeCount; i++) {
        const r = 15 + Math.random() * 150;
        const theta = Math.random() * Math.PI * 2;
        const x = Math.cos(theta) * r;
        const z = Math.sin(theta) * r;
        
        const h = getWorldHeightAt(x, z);
        if (h > 20 || h < -5) continue;
        
        const scale = 0.5 + Math.random() * 0.8;
        const treeBase = new THREE.Group();
        
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = 0.5 * scale;
        trunk.scale.set(scale, scale, scale);
        trunk.castShadow = true; trunk.receiveShadow = true;
        treeBase.add(trunk);
        
        const layer1 = new THREE.Mesh(canopyGeo1, canopyMat);
        layer1.position.y = 1.5 * scale;
        layer1.scale.set(scale, scale, scale);
        layer1.castShadow = true; layer1.receiveShadow = true;
        treeBase.add(layer1);
        
        const layer2 = new THREE.Mesh(canopyGeo2, canopyMat);
        layer2.position.y = 2.8 * scale;
        layer2.scale.set(scale, scale, scale);
        layer2.castShadow = true; layer2.receiveShadow = true;
        treeBase.add(layer2);
        
        const layer3 = new THREE.Mesh(canopyGeo3, canopyMat);
        layer3.position.y = 4.0 * scale;
        layer3.scale.set(scale, scale, scale);
        layer3.castShadow = true; layer3.receiveShadow = true;
        treeBase.add(layer3);
        
        treeBase.position.set(x, h, z);
        group.add(treeBase);
    }
    
    return group;
}

// ============================================================
// Floating music notes (subtle, bright)
// ============================================================
function createFloatingNotes() {
    const group = new THREE.Group();
    const noteCount = 25;

    for (let i = 0; i < noteCount; i++) {
        const geo = new THREE.CircleGeometry(0.1 + Math.random() * 0.15, 8);
        const hue = 0.55 + Math.random() * 0.15; // Blue-purple range
        const color = new THREE.Color().setHSL(hue, 0.6, 0.6);
        const mat = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.25 + Math.random() * 0.25,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        const note = new THREE.Mesh(geo, mat);
        note.position.set(
            (Math.random() - 0.5) * 100,
            3 + Math.random() * 25,
            -10 - Math.random() * 30
        );
        note.userData.driftSpeed = 0.1 + Math.random() * 0.3;
        note.userData.driftPhase = Math.random() * Math.PI * 2;
        note.userData.baseY = note.position.y;
        group.add(note);
    }

    return group;
}

// ============================================================
// Initialization
// ============================================================

export function initLandscape({ container, performances, audioContext, onPerformanceSelect }) {
    callbacks.onSelect = onPerformanceSelect;
    isActive = true;

    // Scene
    scene = new THREE.Scene();
    scene.add(createSkySphere());

    // Camera
    camera = new THREE.PerspectiveCamera(
        CAMERA.fov,
        window.innerWidth / window.innerHeight,
        CAMERA.near,
        CAMERA.far
    );
    camera.position.set(0, 30, 80);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 10;
    controls.maxDistance = 350;
    controls.maxPolarAngle = Math.PI / 2.05; // Drop slightly below horizon
    controls.minPolarAngle = Math.PI / 12;
    controls.target.set(0, 0, 0);
    controls.enablePan = true;

    // Clock
    clock = new THREE.Clock();

    // Lighting (Bright daylight)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6); // White ambient
    scene.add(ambientLight);
    
    const dirLight = new THREE.DirectionalLight(0xfff8d6, 1.2); // Bright sunlight
    dirLight.position.set(150, 200, -80);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.left = -150;
    dirLight.shadow.camera.right = 150;
    dirLight.shadow.camera.top = 150;
    dirLight.shadow.camera.bottom = -150;
    dirLight.shadow.camera.far = 500;
    dirLight.shadow.bias = -0.001;
    scene.add(dirLight);

    // === BUILD THE 3D SCENE ===

    // 1. Terrain Mesh
    const terrain = createTerrain();
    scene.add(terrain);

    // 2. Churches
    const church1 = createChurch(20, -25, 0.8);
    church1.rotation.y = Math.PI / 6;
    scene.add(church1);
    
    const church2 = createChurch(-35, 15, 0.45);
    church2.rotation.y = -Math.PI / 4;
    scene.add(church2);

    // 3. Clouds
    const clouds = createClouds();
    scene.add(clouds);

    // 4. Pine trees
    scene.add(createPineTrees());

    // 5. Floating music notes
    scene.add(createFloatingNotes());

    // Atmospheric fog matches bright horizon
    scene.fog = new THREE.FogExp2('#b4e7ff', 0.003);

    // Performance entities
    createEntities(performances, audioContext);

    // Audio preview
    audioPreview = new AudioPreviewPlayer(audioContext);

    // Raycaster for interaction
    setupInteraction(container);

    // Setup Time Machine dial
    setupTimeMachine(performances);

    // Handle resize
    window.addEventListener('resize', handleResize);

    // Start animation loop
    animate();
}

// ============================================================
// Time Machine
// ============================================================

function setupTimeMachine(performances) {
    const track = document.getElementById('time-machine-track');
    const container = document.getElementById('time-machine');
    if (!track || !container) return;
    
    // Explicitly add a 21-year span (2004-2024) for the demo
    const yearsList = [];
    for (let y = 2024; y >= 2004; y--) {
        yearsList.push(y);
    }
    
    // Add "All", then years in descending order
    const availableYears = ['All', ...yearsList];
    
    track.innerHTML = '';
    
    // Add padding elements so first/last can center
    const paddingStart = document.createElement('div');
    paddingStart.style.flex = `0 0 calc(50% - 70px)`;
    track.appendChild(paddingStart);
    
    availableYears.forEach(year => {
        const el = document.createElement('div');
        el.className = 'time-machine-year';
        el.textContent = year;
        el.dataset.year = year;
        track.appendChild(el);
        
        el.addEventListener('click', () => {
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        });
    });
    
    const paddingEnd = document.createElement('div');
    paddingEnd.style.flex = `0 0 calc(50% - 70px)`;
    track.appendChild(paddingEnd);
    
    let scrollTimeout;
    track.addEventListener('scroll', () => {
        if (scrollTimeout) cancelAnimationFrame(scrollTimeout);
        scrollTimeout = requestAnimationFrame(() => {
            const center = track.scrollLeft + track.clientWidth / 2;
            let closestEl = null;
            let minDiff = Infinity;
            
            const yearEls = track.querySelectorAll('.time-machine-year');
            yearEls.forEach(el => {
                el.classList.remove('active', 'active-adjacent');
                const elCenter = el.offsetLeft + el.offsetWidth / 2;
                const diff = Math.abs(elCenter - center);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestEl = el;
                }
            });
            
            if (closestEl) {
                closestEl.classList.add('active');
                
                const prev = closestEl.previousElementSibling;
                if (prev && prev.classList.contains('time-machine-year')) prev.classList.add('active-adjacent');
                const next = closestEl.nextElementSibling;
                if (next && next.classList.contains('time-machine-year')) next.classList.add('active-adjacent');
                
                const selectedYear = closestEl.dataset.year;
                if (selectedYear !== currentYear) {
                    currentYear = selectedYear;
                    filterEntitiesByYear(currentYear);
                }
            }
        });
    });

    // Init position
    setTimeout(() => track.dispatchEvent(new Event('scroll')), 100);
}

function filterEntitiesByYear(year) {
    const isAll = year === 'All';
    const targetY = parseInt(year);
    
    entities.forEach(entity => {
        const perf = entity.userData.performance;
        const match = isAll || perf.year === targetY;
        entity.userData.targetScale = match ? 1 : 0.001; 
    });
}

// ============================================================
// Performance Entities
// ============================================================

function createEntities(performances, audioContext) {
    entities = [];

    performances.forEach((perf, index) => {
        const umapX = perf.umap_position?.x ?? (0.15 + (index / performances.length) * 0.7);
        const umapY = perf.umap_position?.y ?? (0.3 + Math.random() * 0.4);

        const worldX = (umapX - 0.5) * 80;
        const worldZ = (umapY - 0.5) * 80 - 15;
        const terrainH = getWorldHeightAt(worldX, worldZ);
        const worldY = terrainH + 3 + Math.random() * 3;

        const features = perf.features_summary || {};

        const entity = createPerformanceEntity({
            performance: perf,
            features,
            position: new THREE.Vector3(worldX, worldY, worldZ),
            index
        });

        entity.userData = {
            performance: perf,
            features,
            baseY: worldY,
            index
        };

        scene.add(entity);
        entities.push(entity);
    });
}

// ============================================================
// Interaction (Raycasting)
// ============================================================

function setupInteraction(container) {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    container.addEventListener('mousemove', (e) => {
        mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(entities, true);

        let hitEntity = null;
        if (intersects.length > 0) {
            let obj = intersects[0].object;
            while (obj && !obj.userData?.performance) {
                obj = obj.parent;
            }
            if (obj && !obj.userData.performance.is_placeholder) {
                hitEntity = obj;
            }
        }

        if (hitEntity !== hoveredEntity) {
            if (hoveredEntity) onEntityUnhover(hoveredEntity);
            if (hitEntity) onEntityHover(hitEntity);
            hoveredEntity = hitEntity;
        }
    });

    container.addEventListener('click', () => {
        if (hoveredEntity && callbacks.onSelect) {
            callbacks.onSelect(hoveredEntity.userData.performance);
        }
    });

    // Keyboard navigation
    let focusedIndex = -1;
    document.addEventListener('keydown', (e) => {
        if (!isActive) return;
        
        // Find next valid non-placeholder entity index
        const findNextValid = (startIndex, step) => {
            let i = (startIndex + step + entities.length) % entities.length;
            while (i !== startIndex) {
                if (!entities[i].userData.performance.is_placeholder) return i;
                i = (i + step + entities.length) % entities.length;
            }
            return startIndex;
        };

        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            focusedIndex = findNextValid(Math.max(0, focusedIndex), 1);
            if (hoveredEntity) onEntityUnhover(hoveredEntity);
            hoveredEntity = entities[focusedIndex];
            if (!hoveredEntity.userData.performance.is_placeholder) onEntityHover(hoveredEntity);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            focusedIndex = findNextValid(focusedIndex === -1 ? 0 : focusedIndex, -1);
            if (hoveredEntity) onEntityUnhover(hoveredEntity);
            hoveredEntity = entities[focusedIndex];
            if (!hoveredEntity.userData.performance.is_placeholder) onEntityHover(hoveredEntity);
        } else if (e.key === 'Enter' && focusedIndex >= 0) {
            const perf = entities[focusedIndex].userData.performance;
            if (!perf.is_placeholder && callbacks.onSelect) callbacks.onSelect(perf);
        }
    });
}

function onEntityHover(entity) {
    const perf = entity.userData.performance;

    entity.userData.isHovered = true;

    entity.traverse(child => {
        if (child.isMesh && child.material) {
            child.material._origEmissive = child.material.emissiveIntensity;
            child.material.emissiveIntensity = ENTITY.hoverBrighten;
        }
    });

    showLabel(entity, perf);
    if (audioPreview && perf.audio_url) {
        audioPreview.play(perf.audio_url, perf.preview_excerpt);
    }
}

function onEntityUnhover(entity) {
    entity.userData.isHovered = false;

    entity.traverse(child => {
        if (child.isMesh && child.material && child.material._origEmissive != null) {
            child.material.emissiveIntensity = child.material._origEmissive;
        }
    });

    hideLabel();
    if (audioPreview) audioPreview.stop();
}

// ============================================================
// Labels (DOM overlay)
// ============================================================

function showLabel(entity, performance) {
    const tooltip = document.getElementById('landscape-tooltip');
    if (!tooltip) return;

    // Use placeholders for missing data
    const conductor = performance.conductor || 'Maestro Placeholder';
    const orchestrator = performance.orchestrator || 'Verbier Festival Ensemble';
    const year = performance.year || '2024';

    document.getElementById('tooltip-title').textContent = performance.title;
    document.getElementById('tooltip-composer').textContent = performance.composer;
    document.getElementById('tooltip-metadata').innerHTML = `
        Conductor: ${conductor}<br>
        Orchestra: ${orchestrator}<br>
        Year: ${year}
    `;

    // Make visible via opacity since .hidden isn't globally defined in this CSS
    tooltip.classList.remove('hidden'); // fail-safe
    tooltip.style.opacity = '1';
    tooltip.style.pointerEvents = 'none';

    updateLabelPosition(entity);
}

function hideLabel() {
    const tooltip = document.getElementById('landscape-tooltip');
    if (tooltip) {
        tooltip.style.opacity = '0';
    }
}

function updateLabelPosition(entity) {
    const tooltip = document.getElementById('landscape-tooltip');
    if (!tooltip || !entity) return;
    
    // Position floating above the entity
    const vector = entity.position.clone();
    vector.y += 2.5; 
    vector.project(camera);
    
    tooltip.style.left = `${(vector.x * 0.5 + 0.5) * window.innerWidth}px`;
    tooltip.style.top = `${(-vector.y * 0.5 + 0.5) * window.innerHeight}px`;
}

// ============================================================
// Animation Loop
// ============================================================

function animate() {
    if (!isActive) return;
    animFrameId = requestAnimationFrame(animate);

    const elapsed = clock.getElapsedTime();
    controls.update();

    // Time Machine distance check
    const dist = controls.getDistance();
    if (dist > 120) {
        if (!timeMachineActive) {
            timeMachineActive = true;
            document.getElementById('time-machine')?.classList.remove('hidden');
        }
    } else {
        if (timeMachineActive) {
            timeMachineActive = false;
            document.getElementById('time-machine')?.classList.add('hidden');
            // User zoomed back in to the valley, reset filter so all pieces return!
            filterEntitiesByYear('All');
        }
    }

    // Animate entities (breathing)
    entities.forEach((entity, i) => {
        const features = entity.userData.features;
        const tempo = features.tempo_bpm || 100;
        const rmsScale = features.rms_mean || 0.04;
        const breathSpeed = (tempo / 120) * ENTITY.breathingSpeed;

        const breath = 1 + Math.sin(elapsed * breathSpeed * Math.PI * 2) * ENTITY.breathingAmplitude * (rmsScale / 0.04);

        // Year filtering transition
        if (entity.userData.targetScale !== undefined) {
            entity.userData.currentScale = entity.userData.currentScale || 1;
            entity.userData.currentScale += (entity.userData.targetScale - entity.userData.currentScale) * 0.1;
            
            if (entity.userData.currentScale < 0.05 && entity.userData.targetScale === 0.001) {
                entity.visible = false;
            } else {
                entity.visible = true;
            }
        } else {
            entity.userData.currentScale = 1;
        }

        if (!entity.userData.isHovered) {
            const finalScale = breath * entity.userData.currentScale;
            entity.scale.set(finalScale, finalScale, finalScale);
        }

        entity.position.y = entity.userData.baseY + Math.sin(elapsed * 0.4 + i * 0.7) * 0.4;
        entity.rotation.y = elapsed * 0.08 + i * 0.5;
    });

    // Animate clouds (slow circular drift)
    scene.traverse(child => {
        if (child.userData?.cloudDrift) {
            const cd = child.userData.cloudDrift;
            const theta = cd.thetaBase + elapsed * cd.speed * 0.05;
            child.position.x = Math.cos(theta) * cd.r;
            child.position.z = Math.sin(theta) * cd.r;
        }
        // Animate floating notes
        if (child.userData?.driftSpeed) {
            child.position.y = child.userData.baseY + Math.sin(elapsed * child.userData.driftSpeed + child.userData.driftPhase) * 1.5;
            child.position.x += Math.sin(elapsed * 0.1 + child.userData.driftPhase) * 0.003;
        }
    });

    // Update label
    if (hoveredEntity && labelEl?.classList.contains('visible')) {
        updateLabelPosition(hoveredEntity);
    }

    renderer.render(scene, camera);
}

// ============================================================
// Lifecycle
// ============================================================

function handleResize() {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

export function disposeLandscape() {
    isActive = false;
    if (animFrameId) cancelAnimationFrame(animFrameId);
    if (audioPreview) audioPreview.dispose();
    if (labelEl) { labelEl.remove(); labelEl = null; }
    window.removeEventListener('resize', handleResize);
}

export function resumeLandscape() {
    isActive = true;
    clock = new THREE.Clock();
    animate();
}
