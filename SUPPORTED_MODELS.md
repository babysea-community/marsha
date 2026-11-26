# Marsha Supported Models

Marsha is not a local model manager. This file is the public model catalog for the self-hosted deployment: which Marsha model names can be selected on the canvas and in chain inputs, which provider mode can execute them, and which Semantic Lady provider model id each one routes to.

## Use cases

Marsha runs workflow-driven media chains for applications that need an HTTP API instead of an interactive workflow UI. The built-in `chain` template starts with an image model, can pass through a second image model, runs an image-to-video model, and can optionally pass the video into a video-to-video modify model.

The catalog can include provider models that are exposed for direct routing even when they are not the recommended final step for the built-in `chain` template. Chain compatibility is enforced by the template layer at run creation time.

| Model workflows                                                           |
| :------------------------------------------------------------------------ |
| `text-to-image` → `image-to-video`                                        |
| `text-to-image` → `image-to-video` → `video-to-video`                     |
| `text-to-image` → `image-to-image` → `image-to-video`                     |
| `text-to-image` → `image-to-image` → `image-to-video` → `video-to-video`  |
| `image-to-image` → `image-to-video`                                       |
| `image-to-image` → `image-to-video` → `video-to-video`                    |
| `image-to-image` → `image-to-image` → `image-to-video`                    |
| `image-to-image` → `image-to-image` → `image-to-video` → `video-to-video` |

## Model table

The table lists the 54 Marsha model entries returned by the public model catalog.

| No  | Inference Provider | Model Name in Marsha            | Type  | Mode Options |
| :-- | :----------------- | :------------------------------ | :---: | ------------ |
| 1   | Alibaba Cloud      | `qwen/image`                    | Image | BYOK/BabySea |
| 2   | Alibaba Cloud      | `qwen/image-2`                  | Image | BYOK         |
| 3   | Alibaba Cloud      | `qwen/image-2-pro`              | Image | BYOK         |
| 4   | Alibaba Cloud      | `qwen/image-edit`               | Image | BYOK         |
| 5   | Alibaba Cloud      | `qwen/image-edit-max`           | Image | BYOK         |
| 6   | Alibaba Cloud      | `qwen/image-edit-plus`          | Image | BYOK         |
| 7   | Alibaba Cloud      | `qwen/image-max`                | Image | BYOK         |
| 8   | Alibaba Cloud      | `qwen/image-plus`               | Image | BYOK         |
| 9   | Alibaba Cloud      | `wan/2.1-imageedit`             | Image | BYOK         |
| 10  | Alibaba Cloud      | `wan/2.5-i2i-preview`           | Image | BYOK         |
| 11  | Alibaba Cloud      | `wan/2.6-image`                 | Image | BYOK         |
| 12  | Alibaba Cloud      | `wan/2.6-t2i`                   | Image | BYOK         |
| 13  | Alibaba Cloud      | `wan/2.7-image`                 | Image | BYOK         |
| 14  | Alibaba Cloud      | `wan/2.7-image-pro`             | Image | BYOK         |
| 15  | Alibaba Cloud      | `z/image-turbo`                 | Image | BYOK         |
| 16  | Alibaba Cloud      | `happyhorse/1.0-i2v`            | Video | BYOK         |
| 17  | Alibaba Cloud      | `happyhorse/1.0-r2v`            | Video | BYOK         |
| 18  | Alibaba Cloud      | `happyhorse/1.0-t2v`            | Video | BYOK         |
| 19  | Alibaba Cloud      | `happyhorse/1.0-video-edit`     | Video | BYOK         |
| 20  | Alibaba Cloud      | `wan/2.7-i2v-2026-04-25`        | Video | BYOK         |
| 21  | Alibaba Cloud      | `wan/2.7-r2v`                   | Video | BYOK         |
| 22  | Alibaba Cloud      | `wan/2.7-t2v`                   | Video | BYOK         |
| 23  | Alibaba Cloud      | `wan/2.7-videoedit`             | Video | BYOK         |
| 24  | Black Forest Labs  | `bfl/flux-1.1-pro`              | Image | BYOK/BabySea |
| 25  | Black Forest Labs  | `bfl/flux-1.1-pro-ultra`        | Image | BYOK/BabySea |
| 26  | Black Forest Labs  | `bfl/flux-2-flex`               | Image | BYOK/BabySea |
| 27  | Black Forest Labs  | `bfl/flux-2-klein-4b`           | Image | BYOK/BabySea |
| 28  | Black Forest Labs  | `bfl/flux-2-klein-9b`           | Image | BYOK/BabySea |
| 29  | Black Forest Labs  | `bfl/flux-2-max`                | Image | BYOK/BabySea |
| 30  | Black Forest Labs  | `bfl/flux-2-pro`                | Image | BYOK/BabySea |
| 31  | BytePlus           | `bytedance/seedream-4`          | Image | BYOK/BabySea |
| 32  | BytePlus           | `bytedance/seedream-4.5`        | Image | BYOK/BabySea |
| 33  | BytePlus           | `bytedance/seedream-5-lite`     | Image | BYOK/BabySea |
| 34  | BytePlus           | `bytedance/seedance-1-pro`      | Video | BYOK/BabySea |
| 35  | BytePlus           | `bytedance/seedance-1-pro-fast` | Video | BYOK/BabySea |
| 36  | BytePlus           | `bytedance/seedance-1.5-pro`    | Video | BYOK/BabySea |
| 37  | BytePlus           | `bytedance/seedance-2.0`        | Video | BYOK         |
| 38  | BytePlus           | `bytedance/seedance-2.0-fast`   | Video | BYOK         |
| 39  | Google             | `google/imagen-4`               | Image | BYOK         |
| 40  | Google             | `google/imagen-4-fast`          | Image | BYOK         |
| 41  | Google             | `google/imagen-4-ultra`         | Image | BYOK         |
| 42  | Google             | `google/nano-banana`            | Image | BYOK         |
| 43  | Google             | `google/nano-banana-2`          | Image | BYOK         |
| 44  | Google             | `google/nano-banana-pro`        | Image | BYOK         |
| 45  | Google             | `google/veo-3.1`                | Video | BYOK         |
| 46  | Google             | `google/veo-3.1-fast`           | Video | BYOK         |
| 47  | Google             | `google/veo-3.1-lite`           | Video | BYOK         |
| 48  | OpenAI             | `gpt/image-2`                   | Image | BYOK         |
| 49  | Runway             | `runway/gen-4-image`            | Image | BYOK         |
| 50  | Runway             | `runway/gen-4-image-turbo`      | Image | BYOK         |
| 51  | Runway             | `runway/aleph-2`                | Video | BYOK         |
| 52  | Runway             | `runway/gen-4.5`                | Video | BYOK         |
| 53  | Runway             | `runway/gen-4-aleph`            | Video | BYOK         |
| 54  | Runway             | `runway/gen-4-turbo`            | Video | BYOK         |

## Mode options

| Mode    | Meaning                                                                                                                                    |
| :------ | :----------------------------------------------------------------------------------------------------------------------------------------- |
| BYOK    | Marsha calls the inference provider directly with server-side provider credentials from your deployment environment.                       |
| BabySea | Marsha calls BabySea with a server-side BabySea API key while keeping the same Marsha run routes, callback contract, and public model IDs. |

Caller applications authenticate to Marsha with Marsha API keys in both modes. Provider credentials should never be sent in chain requests, browser code, screenshots, public issues, or test fixtures.

## Model schema

Marsha exposes Semantic Lady model metadata through the API:

| Endpoint                       | Purpose                                              |
| :----------------------------- | :--------------------------------------------------- |
| `GET /api/v1/models`           | List supported models and schema URLs                |
| `GET /api/v1/models/{modelId}` | Return one Semantic Lady `generation_*` model schema |

Example model schema URL: `GET /api/v1/models/bfl/flux-2-max`.

BabySea mode keeps using BabySea's normalized `generation_*` schema. BYOK mode uses the Semantic Lady `generation_*` schema returned by these routes. Marsha does not publish a separate provider request schema catalog.

| Inference/Execution | Type  | Documentation                                                                                                                            |
| :------------------ | :---- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| BabySea             | Image | [https://babysea.ai/model-schema](https://babysea.ai/model-schema)                                                                       |
|                     | Video | [https://babysea.ai/model-schema](https://babysea.ai/model-schema)                                                                       |
| Alibaba Cloud       | Image | [https://www.alibabacloud.com/help/en/model-studio/image-generation](https://www.alibabacloud.com/help/en/model-studio/image-generation) |
|                     | Video | [https://www.alibabacloud.com/help/en/model-studio/video-generation](https://www.alibabacloud.com/help/en/model-studio/video-generation) |
| Black Forest Labs   | Image | [https://docs.bfl.ml/api-reference](https://docs.bfl.ml/api-reference)                                                                   |
| BytePlus            | Image | [https://docs.byteplus.com/en/docs/ModelArk/1541523](https://docs.byteplus.com/en/docs/ModelArk/1541523)                                 |
|                     | Video | [https://docs.byteplus.com/en/docs/ModelArk/1520757](https://docs.byteplus.com/en/docs/ModelArk/1520757)                                 |
| Google              | Image | [https://ai.google.dev/gemini-api/docs/image-generation](https://ai.google.dev/gemini-api/docs/image-generation)                         |
|                     | Video | [https://ai.google.dev/gemini-api/docs/video](https://ai.google.dev/gemini-api/docs/video)                                               |
| OpenAI              | Image | [https://developers.openai.com/api/docs/guides/image-generation](https://developers.openai.com/api/docs/guides/image-generation)         |
| Runway              | Image | [https://docs.dev.runwayml.com/api](https://docs.dev.runwayml.com/api)                                                                   |
|                     | Video | [https://docs.dev.runwayml.com/api](https://docs.dev.runwayml.com/api)                                                                   |
