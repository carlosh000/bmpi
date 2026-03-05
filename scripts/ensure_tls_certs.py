#!/usr/bin/env python3
"""Ensure local TLS certs for BMPI gRPC are present and valid.

Regenerates certificates when:
- files are missing,
- certificate expires soon,
- required SAN hosts are not present.
"""

from __future__ import annotations

import argparse
import ipaddress
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, List, Set

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def load_cert(path: Path) -> x509.Certificate | None:
    if not path.exists():
        return None
    try:
        return x509.load_pem_x509_certificate(path.read_bytes())
    except Exception:
        return None


def cert_expires_soon(cert: x509.Certificate, threshold_days: int) -> bool:
    threshold = now_utc() + timedelta(days=threshold_days)
    return cert.not_valid_after_utc <= threshold


def cert_hosts(cert: x509.Certificate) -> Set[str]:
    hosts: Set[str] = set()
    try:
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    except Exception:
        return hosts

    for name in san:
        if isinstance(name, x509.DNSName):
            hosts.add(str(name.value).strip().lower())
        elif isinstance(name, x509.IPAddress):
            hosts.add(str(name.value).strip())
    return hosts


def normalize_hosts(values: Iterable[str]) -> List[str]:
    out: List[str] = []
    for value in values:
        raw = value.strip()
        if not raw:
            continue
        if raw not in out:
            out.append(raw)
    return out


def parse_hosts(value: str) -> List[str]:
    return normalize_hosts([item for item in value.split(",")])


def should_regenerate(
    ca_cert: x509.Certificate | None,
    server_cert: x509.Certificate | None,
    required_hosts: List[str],
    threshold_days: int,
) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    if ca_cert is None:
        reasons.append("ca_missing_or_invalid")
    if server_cert is None:
        reasons.append("server_missing_or_invalid")
    if ca_cert and cert_expires_soon(ca_cert, threshold_days):
        reasons.append("ca_expires_soon")
    if server_cert and cert_expires_soon(server_cert, threshold_days):
        reasons.append("server_expires_soon")

    if server_cert:
        existing_hosts = cert_hosts(server_cert)
        missing_hosts = [host for host in required_hosts if host.lower() not in existing_hosts]
        if missing_hosts:
            reasons.append(f"missing_san:{','.join(missing_hosts)}")

    return (len(reasons) > 0), reasons


def write_private_key(path: Path, key: rsa.RSAPrivateKey) -> None:
    path.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )


def generate_certificates(
    ca_cert_path: Path,
    ca_key_path: Path,
    server_cert_path: Path,
    server_key_path: Path,
    hosts: List[str],
    ca_days: int,
    server_days: int,
) -> None:
    now = now_utc()

    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    ca_subject = x509.Name(
        [
            x509.NameAttribute(NameOID.COUNTRY_NAME, "MX"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "BMPI Local CA"),
            x509.NameAttribute(NameOID.COMMON_NAME, "bmpi-local-ca"),
        ]
    )
    ca_cert = (
        x509.CertificateBuilder()
        .subject_name(ca_subject)
        .issuer_name(ca_subject)
        .public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=ca_days))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                key_cert_sign=True,
                crl_sign=True,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                content_commitment=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .sign(private_key=ca_key, algorithm=hashes.SHA256())
    )

    server_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    san_entries: list[x509.GeneralName] = []
    for host in hosts:
        try:
            san_entries.append(x509.IPAddress(ipaddress.ip_address(host)))
        except ValueError:
            san_entries.append(x509.DNSName(host))

    server_subject_cn = hosts[0] if hosts else "localhost"
    server_subject = x509.Name(
        [
            x509.NameAttribute(NameOID.COUNTRY_NAME, "MX"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "BMPI Local"),
            x509.NameAttribute(NameOID.COMMON_NAME, server_subject_cn),
        ]
    )

    server_cert = (
        x509.CertificateBuilder()
        .subject_name(server_subject)
        .issuer_name(ca_subject)
        .public_key(server_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=server_days))
        .add_extension(x509.SubjectAlternativeName(san_entries), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                key_encipherment=True,
                key_cert_sign=False,
                crl_sign=False,
                data_encipherment=False,
                key_agreement=False,
                content_commitment=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .sign(private_key=ca_key, algorithm=hashes.SHA256())
    )

    for path in (ca_cert_path, ca_key_path, server_cert_path, server_key_path):
        path.parent.mkdir(parents=True, exist_ok=True)

    write_private_key(ca_key_path, ca_key)
    ca_cert_path.write_bytes(ca_cert.public_bytes(serialization.Encoding.PEM))
    write_private_key(server_key_path, server_key)
    server_cert_path.write_bytes(server_cert.public_bytes(serialization.Encoding.PEM))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ca-cert", required=True)
    parser.add_argument("--ca-key", required=True)
    parser.add_argument("--server-cert", required=True)
    parser.add_argument("--server-key", required=True)
    parser.add_argument("--hosts", default="localhost,127.0.0.1")
    parser.add_argument("--renew-days", type=int, default=30)
    parser.add_argument("--ca-valid-days", type=int, default=3650)
    parser.add_argument("--server-valid-days", type=int, default=825)
    args = parser.parse_args()

    ca_cert_path = Path(args.ca_cert)
    ca_key_path = Path(args.ca_key)
    server_cert_path = Path(args.server_cert)
    server_key_path = Path(args.server_key)
    hosts = parse_hosts(args.hosts)
    if "localhost" not in [h.lower() for h in hosts]:
        hosts.append("localhost")
    if "127.0.0.1" not in hosts:
        hosts.append("127.0.0.1")

    ca_cert = load_cert(ca_cert_path)
    server_cert = load_cert(server_cert_path)
    regenerate, reasons = should_regenerate(ca_cert, server_cert, hosts, args.renew_days)
    if regenerate:
        generate_certificates(
            ca_cert_path=ca_cert_path,
            ca_key_path=ca_key_path,
            server_cert_path=server_cert_path,
            server_key_path=server_key_path,
            hosts=hosts,
            ca_days=args.ca_valid_days,
            server_days=args.server_valid_days,
        )
        print(f"TLS_CERTS_REGENERATED reasons={';'.join(reasons)} hosts={','.join(hosts)}")
    else:
        print("TLS_CERTS_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
