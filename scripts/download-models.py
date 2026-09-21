from pathlib import Path
from huggingface_hub import snapshot_download
import shutil

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "public" / "models"


def download_model(repo_id, target, patterns):
    destination = MODELS / target

    destination.mkdir(
        parents=True,
        exist_ok=True,
    )

    print()
    print("=" * 72)
    print(f"Downloading {repo_id}")
    print(f"→ {destination}")
    print("=" * 72)

    snapshot_download(
        repo_id=repo_id,
        local_dir=str(destination),
        allow_patterns=patterns,
    )

    # snapshot_download creates metadata that is useful
    # for HF syncing but unnecessary for our static app.
    hf_cache = destination / ".cache"

    if hf_cache.exists():
        shutil.rmtree(hf_cache)

    print(f"✓ {repo_id}")


def main():
    MODELS.mkdir(
        parents=True,
        exist_ok=True,
    )

    # ---------------------------------------------------------
    # LOCAL CRITIC
    #
    # Only download q4f16.
    #
    # Important: Llama's ONNX graph references TWO external
    # data shards, so model_q4f16.onnx alone is not sufficient.
    # ---------------------------------------------------------

    download_model(
        repo_id=(
            "onnx-community/"
            "Llama-3.2-3B-Instruct-ONNX"
        ),
        target=(
            "onnx-community/"
            "Llama-3.2-3B-Instruct-ONNX"
        ),
        patterns=[
            "config.json",
            "generation_config.json",
            "quantize_config.json",
            "tokenizer.json",
            "tokenizer_config.json",
            "special_tokens_map.json",
            "chat_template.jinja",
            "LICENSE.txt",
            "USE_POLICY.md",

            "onnx/model_q4f16.onnx",
            "onnx/model_q4f16.onnx_data",
            "onnx/model_q4f16.onnx_data_1",
        ],
    )

    # ---------------------------------------------------------
    # LOCAL EMBEDDING MODEL
    #
    # This one is tiny compared with Llama.
    # q4f16 is about 33 MB.
    # ---------------------------------------------------------

    download_model(
        repo_id=(
            "mixedbread-ai/"
            "mxbai-embed-xsmall-v1"
        ),
        target=(
            "mixedbread-ai/"
            "mxbai-embed-xsmall-v1"
        ),
        patterns=[
            "config.json",
            "config_sentence_transformers.json",
            "modules.json",
            "tokenizer.json",
            "tokenizer_config.json",
            "special_tokens_map.json",
            "vocab.txt",
            "1_Pooling/config.json",

            "onnx/model_q4f16.onnx",
        ],
    )

    print()
    print("=" * 72)
    print("All local models downloaded.")
    print(f"Location: {MODELS}")
    print("=" * 72)


if __name__ == "__main__":
    main()