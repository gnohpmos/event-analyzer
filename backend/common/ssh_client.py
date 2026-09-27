"""
Managed SSH Client Provider.
Encapsulates Paramiko SSH connection lifecycle, credential handling,
and safe resource cleanup for network device automation.
Follows Context Manager pattern and DRY.
"""
import logging
import time
from typing import Optional, List, Tuple
from common.settings_helper import get_setting

logger = logging.getLogger(__name__)


class ManagedSSHClient:
    """
    Context manager for robust SSH connections to network routers.
    Automatically handles timeouts, key policies, and safe connection closure.
    """

    def __init__(
        self,
        host: str,
        username: Optional[str] = None,
        password: Optional[str] = None,
        port: int = 22,
        timeout: int = 8
    ):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.username = username or get_setting('SSH_USERNAME', 'admin')
        self.password = password if password is not None else get_setting('SSH_PASSWORD', '')
        self._client = None

    def __enter__(self):
        if not self.password:
            raise ValueError(f"SSH Password not configured for host={self.host}")

        try:
            import paramiko
        except ImportError:
            raise ImportError("Paramiko library is not installed in the runtime environment")

        self._client = paramiko.SSHClient()
        self._client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        logger.info(
            f"SSH_CONNECT: Connecting to {self.host}:{self.port} as '{self.username}' (timeout={self.timeout}s)"
        )
        self._client.connect(
            hostname=self.host,
            port=self.port,
            username=self.username,
            password=self.password,
            timeout=self.timeout,
            banner_timeout=self.timeout,
            auth_timeout=self.timeout,
            look_for_keys=False,
            allow_agent=False
        )
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

    def close(self):
        """Safely closes the active SSH client."""
        if self._client:
            try:
                self._client.close()
            except Exception:
                pass
            finally:
                self._client = None

    def execute_command(self, command: str) -> str:
        """Executes a single CLI command and returns decoded output."""
        if not self._client:
            raise RuntimeError("SSH Client is not connected")

        stdin, stdout, stderr = self._client.exec_command(command, timeout=self.timeout)
        return stdout.read().decode('utf-8', errors='ignore')

    def execute_with_fallback(self, commands: List[str], invalid_tokens: Optional[List[str]] = None) -> Tuple[str, str]:
        """
        Executes a sequence of commands until one returns non-empty, valid output.
        Returns: (output, successful_command)
        """
        invalid_tokens = invalid_tokens or ["invalid input", "syntax error"]
        for cmd in commands:
            output = self.execute_command(cmd)
            if output and not any(token in output.lower() for token in invalid_tokens):
                return output, cmd
        return "", commands[-1] if commands else ""

    def open_interactive_shell(self, term: str = 'vt100', width: int = 256, height: int = 100):
        """Opens and returns an interactive shell channel with pre-flushed banner."""
        if not self._client:
            raise RuntimeError("SSH Client is not connected")

        channel = self._client.invoke_shell(term=term, width=width, height=height)
        channel.settimeout(self.timeout)
        time.sleep(1.2)

        # Flush initial login/MOTD banner
        while channel.recv_ready():
            channel.recv(65535)

        return channel
