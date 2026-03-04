
 OVERVIEW
 ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
| key                | value                 |
| ---                | ---                   |
| version            | 2.0                   |
| generator          | glTF-Transform v4.3.0 |
| extensionsUsed     | none                  |
| extensionsRequired | none                  |



 SCENES
 ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
| #   | name  | rootName | bboxMin               | bboxMax                 | renderVertexCount┬╣ | uploadVertexCount | uploadNaiveVertexCount |
| --- | ---   | ---      | ---                   | ---                     | ---                | ---               | ---                    |
| 0   | Scene | Armature | -0.00571, 0, -0.00442 | 0.00571, 0.017, 0.00442 | 90,000             | 19,670            | 19,670                 |

┬╣ Expected number of vertices processed by the vertex shader for one render
  pass, without considering the vertex cache.

┬▓ Expected number of vertices uploaded to GPU, assuming each Accessor
  is uploaded only once. Actual number uploaded may be higher, 
  dependent on the implementation and vertex buffer layout.

┬│ Expected number of vertices uploaded to GPU, assuming each Primitive
  is uploaded once, duplicating vertex attributes shared among Primitives.



 MESHES
 ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
| #   | name  | mode      | meshPrimitives | glPrimitives | vertices | indices | attributes                                                           | instances | size┬╣  |
| --- | ---   | ---       | ---            | ---          | ---      | ---     | ---                                                                  | ---       | ---    |
| 0   | char1 | TRIANGLES | 1              | 30,000       | 19,670   | u16     | JOINTS_0:u8, NORMAL:f32, POSITION:f32, TEXCOORD_0:f32, WEIGHTS_0:f32 | 1         | 1.2 MB |

Γü┤ size estimates GPU memory required by a mesh, in isolation. If accessors are
  shared by other mesh primitives, but the meshes themselves are not reused, then
  the sum of all mesh sizes will overestimate the asset's total size. See "dedup".



 MATERIALS
 ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
| #   | name       | instances | textures                          | alphaMode | doubleSided |
| --- | ---        | ---       | ---                               | ---       | ---         |
| 0   | Material_1 | 1         | baseColorTexture, emissiveTexture | OPAQUE    | Γ£ô           |



 TEXTURES
 ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
| #   | name      | uri | slots                             | instances | mimeType  | compression | resolution | size    | gpuSizeΓü╡ |
| --- | ---       | --- | ---                               | ---       | ---       | ---         | ---        | ---     | ---      |
| 0   | texture_0 |     | baseColorTexture, emissiveTexture | 1         | image/png |             | 2048x2048  | 4.68 MB | 22.37 MB |

Γü╡ gpuSize estimates minimum VRAM memory allocation. Older devices may require
  additional memory for GPU compression formats.



 ANIMATIONS
 ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
| #   | name                     | channels | samplers | duration | keyframes | size      |
| --- | ---                      | ---      | ---      | ---      | ---       | ---       |
| 0   | Armature|clip0|baselayer | 72       | 72       | 0        | 72        | 964 Bytes |
| 1   | walking                  | 60       | 72       | 1        | 864       | 13.46 KB  |
| 2   | running                  | 60       | 72       | 1        | 576       | 8.85 KB   |
| 3   | idle                     | 72       | 72       | 14       | 9,758     | 155.76 KB |


