/**
 * performance-entity.js — Organic luminous entity for each performance
 *
 * Creates a custom Three.js mesh: icosphere with vertex displacement from Tonnetz,
 * colored by chroma, with glow halo driven by spectral bandwidth.
 */

import * as THREE from 'three';
import { ENTITY, CHROMA_HUE_MAP } from '../../shared/constants.js';

/**
 * Create a performance entity mesh group.
 * @param {Object} opts
 * @param {Object} opts.performance - Performance metadata
 * @param {Object} opts.features - Feature summary
 * @param {THREE.Vector3} opts.position - World position
 * @param {number} opts.index - Entity index
 * @returns {THREE.Group}
 */
export function createPerformanceEntity({ performance, features, position, index }) {
    const group = new THREE.Group();
    group.position.copy(position);

    // Determine color from dominant chroma
    const chromaIndex = features.dominant_chroma ?? (index % 12);
    const hue = CHROMA_HUE_MAP[chromaIndex] / 360;
    let saturation = mapRange(
        features.spectral_centroid_mean ?? 2000,
        500, 4000,
        0.3, 0.95
    );
    let lightness = 0.5;

    if (performance.is_placeholder) {
        saturation = 0.0;
        lightness = 0.4;
    }

    const color = new THREE.Color().setHSL(hue, saturation, lightness);

    // Determine base size from RMS
    const rms = features.rms_mean ?? 0.04;
    const baseSize = mapRange(rms, 0.01, 0.1, ENTITY.minRadius, ENTITY.maxRadius);

    // Create core orb (icosahedron with vertex displacement)
    const coreGeometry = new THREE.IcosahedronGeometry(baseSize, ENTITY.segments > 16 ? 3 : 2);

    // Apply Tonnetz-based vertex displacement
    const tonnetz = features.tonnetz_mean ?? [0, 0, 0, 0, 0, 0];
    const positionAttr = coreGeometry.attributes.position;
    for (let i = 0; i < positionAttr.count; i++) {
        const x = positionAttr.getX(i);
        const y = positionAttr.getY(i);
        const z = positionAttr.getZ(i);

        // Use tonnetz dimensions for organic distortion
        const displacement = (
            tonnetz[0] * Math.sin(x * 3) +
            tonnetz[1] * Math.cos(y * 3) +
            tonnetz[2] * Math.sin(z * 3) +
            tonnetz[3] * Math.cos(x * 2 + z) +
            tonnetz[4] * Math.sin(y * 2 + x) +
            tonnetz[5] * Math.cos(z * 2 + y)
        ) * ENTITY.tonnetzDisplacementScale;

        const normal = new THREE.Vector3(x, y, z).normalize();
        positionAttr.setXYZ(
            i,
            x + normal.x * displacement,
            y + normal.y * displacement,
            z + normal.z * displacement
        );
    }
    coreGeometry.computeVertexNormals();

    const emissiveIntensity = performance.is_placeholder ? 0.0 : ENTITY.glowIntensity;
    const opacity = performance.is_placeholder ? 0.25 : 0.9;

    const coreMaterial = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: emissiveIntensity,
        roughness: 0.3,
        metalness: 0.5,
        transparent: true,
        opacity: opacity
    });

    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    group.add(core);

    if (!performance.is_placeholder) {
        // Create glowing halo (from spectral bandwidth)
        const bandwidth = features.spectral_bandwidth_mean ?? 1500;
        const haloScale = mapRange(bandwidth, 500, 3000, 1.3, 2.5);

        const haloGeometry = new THREE.SphereGeometry(baseSize * haloScale, 16, 16);
        const haloMaterial = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: ENTITY.haloOpacity * 0.5,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.BackSide
        });

        const halo = new THREE.Mesh(haloGeometry, haloMaterial);
        group.add(halo);

        // Create second inner halo for depth
        const innerHaloGeometry = new THREE.SphereGeometry(baseSize * 1.15, 16, 16);
        const innerHaloMaterial = new THREE.MeshBasicMaterial({
            color: color.clone().multiplyScalar(1.5),
            transparent: true,
            opacity: ENTITY.haloOpacity * 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const innerHalo = new THREE.Mesh(innerHaloGeometry, innerHaloMaterial);
        group.add(innerHalo);

        // Surface particles (driven by spectral flux)
        const flux = features.spectral_flux_mean ?? 0.5;
        const particleCount = Math.floor(mapRange(flux, 0.1, 1.0, 20, 200));
        createSurfaceParticles(group, baseSize, color, particleCount);
    }

    return group;
}

function createSurfaceParticles(parent, radius, color, count) {
    const positions = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
        // Distribute on sphere surface
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = radius * (1.1 + Math.random() * 0.5);

        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = r * Math.cos(phi);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
        color: color.clone().multiplyScalar(1.3),
        size: 0.08,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true
    });

    const particles = new THREE.Points(geometry, material);
    parent.add(particles);
}

function mapRange(value, inMin, inMax, outMin, outMax) {
    return outMin + (Math.max(inMin, Math.min(inMax, value)) - inMin) / (inMax - inMin) * (outMax - outMin);
}
