/**
 * 2D to 3D Transformer
 * Transforms uploaded 2D images into interactive 3D visualizations using Three.js
 */

(function () {
    'use strict';

    // State
    let scene, camera, renderer, controls, currentMesh, texture;
    let animationId = null;
    let currentMode = 'plane';

    // DOM Elements
    const viewport = document.getElementById('viewport');
    const placeholder = document.getElementById('placeholder');
    const imageUpload = document.getElementById('image-upload');
    const fileName = document.getElementById('file-name');
    const depthSlider = document.getElementById('depth-slider');
    const segmentsSlider = document.getElementById('segments-slider');
    const amplitudeSlider = document.getElementById('amplitude-slider');
    const wireframeToggle = document.getElementById('wireframe-toggle');
    const autorotateToggle = document.getElementById('autorotate-toggle');
    const lightSlider = document.getElementById('light-slider');
    const bgColor = document.getElementById('bg-color');
    const modeButtons = document.querySelectorAll('.mode-btn');
    const viewportContainer = document.querySelector('.viewport-container');

    // Slider value displays
    const depthValue = document.getElementById('depth-value');
    const segmentsValue = document.getElementById('segments-value');
    const amplitudeValue = document.getElementById('amplitude-value');
    const lightValue = document.getElementById('light-value');

    // Lights
    let ambientLight, directionalLight;

    // ==================== Initialization ====================

    function initScene() {
        // Scene
        scene = new THREE.Scene();
        scene.background = new THREE.Color(bgColor.value);

        // Camera
        camera = new THREE.PerspectiveCamera(
            60,
            viewport.clientWidth / viewport.clientHeight,
            0.1,
            1000
        );
        camera.position.set(0, 0, 3);

        // Renderer
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(viewport.clientWidth, viewport.clientHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        viewport.appendChild(renderer.domElement);

        // Controls
        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.autoRotate = autorotateToggle.checked;
        controls.autoRotateSpeed = 2.0;

        // Lights
        ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        scene.add(ambientLight);

        directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
        directionalLight.position.set(5, 5, 5);
        scene.add(directionalLight);

        // Start render loop
        animate();

        // Handle resize
        window.addEventListener('resize', onResize);
    }

    function animate() {
        animationId = requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    }

    function onResize() {
        if (!renderer) return;
        const w = viewport.clientWidth;
        const h = viewport.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    }

    // ==================== Image Loading ====================

    function loadImage(file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            const loader = new THREE.TextureLoader();
            loader.load(e.target.result, function (tex) {
                texture = tex;
                texture.wrapS = THREE.RepeatWrapping;
                texture.wrapT = THREE.RepeatWrapping;
                placeholder.style.display = 'none';
                buildMesh();
            });
        };
        reader.readAsDataURL(file);
    }

    // ==================== Mesh Generation ====================

    function buildMesh() {
        if (!texture) return;

        // Remove existing mesh
        if (currentMesh) {
            scene.remove(currentMesh);
            if (currentMesh.geometry) currentMesh.geometry.dispose();
            if (currentMesh.material) currentMesh.material.dispose();
            currentMesh = null;
        }

        const depth = depthSlider.value / 100;
        const segments = parseInt(segmentsSlider.value);
        const amplitude = amplitudeSlider.value / 100;
        const wireframe = wireframeToggle.checked;

        let geometry;
        let material = new THREE.MeshStandardMaterial({
            map: texture,
            wireframe: wireframe,
            side: THREE.DoubleSide
        });

        switch (currentMode) {
            case 'plane':
                geometry = createPlaneGeometry(segments, depth);
                break;
            case 'box':
                geometry = createBoxGeometry(segments, depth);
                break;
            case 'cylinder':
                geometry = createCylinderGeometry(segments, depth);
                break;
            case 'sphere':
                geometry = createSphereGeometry(segments);
                break;
            case 'wave':
                geometry = createWaveGeometry(segments, amplitude);
                break;
            case 'terrain':
                geometry = createTerrainGeometry(segments, amplitude);
                break;
            default:
                geometry = createPlaneGeometry(segments, depth);
        }

        currentMesh = new THREE.Mesh(geometry, material);
        scene.add(currentMesh);
    }

    function createPlaneGeometry(segments, depth) {
        const geo = new THREE.PlaneGeometry(2, 2, segments, segments);
        // Add slight curvature based on depth
        const positions = geo.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            const dist = Math.sqrt(x * x + y * y);
            positions.setZ(i, -dist * depth * 0.5);
        }
        geo.computeVertexNormals();
        return geo;
    }

    function createBoxGeometry(segments, depth) {
        const extrudeDepth = Math.max(0.1, depth * 2);
        const geo = new THREE.BoxGeometry(2, 2, extrudeDepth, segments, segments, segments);
        return geo;
    }

    function createCylinderGeometry(segments, depth) {
        const radius = 0.8 + depth * 0.5;
        const geo = new THREE.CylinderGeometry(radius, radius, 2, segments, segments, false);
        return geo;
    }

    function createSphereGeometry(segments) {
        const geo = new THREE.SphereGeometry(1.2, segments, segments);
        return geo;
    }

    function createWaveGeometry(segments, amplitude) {
        const geo = new THREE.PlaneGeometry(2.5, 2.5, segments, segments);
        const positions = geo.attributes.position;
        const time = Date.now() * 0.001;
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            const wave = Math.sin(x * 3 + time) * Math.cos(y * 3 + time) * amplitude;
            positions.setZ(i, wave);
        }
        geo.computeVertexNormals();
        return geo;
    }

    function createTerrainGeometry(segments, amplitude) {
        const geo = new THREE.PlaneGeometry(3, 3, segments, segments);
        const positions = geo.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            // Layered noise-like displacement
            const h =
                Math.sin(x * 2.5) * Math.cos(y * 2.5) * 0.4 +
                Math.sin(x * 5.1 + 1.3) * Math.cos(y * 4.7 + 0.8) * 0.2 +
                Math.sin(x * 10.3 + 2.1) * Math.cos(y * 9.7 + 1.5) * 0.1;
            positions.setZ(i, h * amplitude * 2);
        }
        geo.computeVertexNormals();
        return geo;
    }

    // ==================== Wave Animation ====================

    let waveAnimating = false;

    function animateWave() {
        if (currentMode !== 'wave' || !currentMesh) {
            waveAnimating = false;
            return;
        }
        waveAnimating = true;
        const amplitude = amplitudeSlider.value / 100;
        const positions = currentMesh.geometry.attributes.position;
        const time = Date.now() * 0.002;
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            const wave = Math.sin(x * 3 + time) * Math.cos(y * 3 + time) * amplitude;
            positions.setZ(i, wave);
        }
        positions.needsUpdate = true;
        currentMesh.geometry.computeVertexNormals();
        requestAnimationFrame(animateWave);
    }

    // ==================== Event Handlers ====================

    // Image upload
    imageUpload.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (file) {
            fileName.textContent = file.name;
            loadImage(file);
        }
    });

    // Drag and drop
    viewportContainer.addEventListener('dragover', function (e) {
        e.preventDefault();
        viewportContainer.classList.add('drag-over');
    });

    viewportContainer.addEventListener('dragleave', function () {
        viewportContainer.classList.remove('drag-over');
    });

    viewportContainer.addEventListener('drop', function (e) {
        e.preventDefault();
        viewportContainer.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            fileName.textContent = file.name;
            loadImage(file);
        }
    });

    // Mode buttons
    modeButtons.forEach(function (btn) {
        btn.addEventListener('click', function () {
            modeButtons.forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            currentMode = btn.dataset.mode;
            buildMesh();
            if (currentMode === 'wave' && !waveAnimating) {
                animateWave();
            }
        });
    });

    // Sliders
    depthSlider.addEventListener('input', function () {
        depthValue.textContent = this.value;
        buildMesh();
    });

    segmentsSlider.addEventListener('input', function () {
        segmentsValue.textContent = this.value;
        buildMesh();
    });

    amplitudeSlider.addEventListener('input', function () {
        amplitudeValue.textContent = this.value;
        buildMesh();
    });

    lightSlider.addEventListener('input', function () {
        lightValue.textContent = this.value;
        const intensity = this.value / 100;
        if (directionalLight) directionalLight.intensity = intensity;
    });

    // Wireframe toggle
    wireframeToggle.addEventListener('change', function () {
        if (currentMesh && currentMesh.material) {
            currentMesh.material.wireframe = this.checked;
        }
    });

    // Auto-rotate toggle
    autorotateToggle.addEventListener('change', function () {
        if (controls) controls.autoRotate = this.checked;
    });

    // Background color
    bgColor.addEventListener('input', function () {
        if (scene) scene.background = new THREE.Color(this.value);
    });

    // ==================== Start ====================
    initScene();

})();
