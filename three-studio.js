import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export function setupStudioEnvironment(renderer, scene) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.8;

  const environmentGenerator = new THREE.PMREMGenerator(renderer);
  const environment = environmentGenerator.fromScene(new RoomEnvironment(), 0.04);
  environmentGenerator.dispose();
  scene.environment = environment.texture;
  scene.environmentIntensity = 1.5;
  return environment;
}

export function enhanceMetalReflections(model) {
  model.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      if (
        !material ||
        !(material.isMeshStandardMaterial || material.isMeshPhysicalMaterial) ||
        material.metalness <= 0.5
      ) {
        return;
      }
      material.envMapIntensity = 1.5;
      material.needsUpdate = true;
    });
  });
}

export function boostModelColor(model, saturationBoost = 0.05) {
  model.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      if (
        material?.color &&
        (material.isMeshStandardMaterial || material.isMeshPhysicalMaterial)
      ) {
        material.color.offsetHSL(0, saturationBoost, 0);
      }
    });
  });
}
