import os
import random
import logging
from typing import List, Optional

logger = logging.getLogger(__name__)

def _load_keys(env_prefix: str) -> List[str]:
    """Carrega uma lista de chaves de API a partir de uma variável de ambiente.
    Exemplo: ``ELEVENLABS_API_KEYS=key1,key2,key3``
    """
    raw = os.getenv(env_prefix, "")
    return [k.strip() for k in raw.split(',') if k.strip()]

def get_api_key(env_prefix: str) -> Optional[str]:
    """Retorna uma chave aleatória da lista. Se a lista estiver vazia, devolve ``None``.
    """
    keys = _load_keys(env_prefix)
    if not keys:
        return None
    return random.choice(keys)

def rotate_on_error(current_key: str, env_prefix: str) -> Optional[str]:
    """Remove a chave que falhou e escolhe outra.
    Atualiza a variável de ambiente para a sessão corrente.
    """
    keys = _load_keys(env_prefix)
    if current_key in keys:
        keys.remove(current_key)
    if not keys:
        logger.warning("Todas as chaves %s foram esgotadas.", env_prefix)
        return None
    os.environ[env_prefix] = ','.join(keys)
    return random.choice(keys)
