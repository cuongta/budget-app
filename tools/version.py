import argparse
import datetime
import subprocess

git_exec = "git"
RELEASE_PREFIX = "RELEASE-v"


def log(msg):
    now = datetime.datetime.now(datetime.timezone.utc)
    print("{} {}".format(now, msg))


def exec_cmd(command):
    output = b""
    rc = 0
    try:
        output = subprocess.check_output(command, shell=True)
    except subprocess.CalledProcessError as e:
        rc = e.returncode
    return output.decode("utf-8"), rc


def get_repo_branch(repo_path):
    branch, rc = exec_cmd(
        "{} -C {} rev-parse --abbrev-ref HEAD".format(git_exec, repo_path)
    )
    if rc != 0:
        print("can't get branch for {}".format(repo_path))
    return branch.strip()


def get_major_minor_patch(repo_path):
    """Return the raw `git describe` output for the nearest RELEASE-v* tag.

    Runs `git describe --tags --long --match "RELEASE-v*"`, which finds the
    most recent tag matching RELEASE-v* and always returns the long form,
    e.g. "RELEASE-v1.2.3-5-gabc1234" (5 commits past tag RELEASE-v1.2.3,
    current commit short-hash abc1234), even when HEAD is exactly on a tag.

    Despite the name, this does not split out major/minor/patch itself —
    that parsing happens in get_version(), where the "patch" component
    actually ends up being the commits-since-tag count, not the tag's own
    patch number.
    """
    long_tag, rc = exec_cmd(
        '{} -C {} describe --tags --long --match "{}*"'.format(
            git_exec, repo_path, RELEASE_PREFIX
        )
    )
    if rc != 0:
        print("can't get most recent master tag for {}".format(repo_path))
    return long_tag.strip()


def get_version(repo_path):
    branch = get_repo_branch(repo_path)
    # ie. long_tag (RELEASE-v1.0-22-gb1690d3)
    long_tag = get_major_minor_patch(repo_path)
    if branch == "master":
        # long_tag = 1.0-22-gb1690d3
        long_tag = long_tag.replace(RELEASE_PREFIX, "")
        major_index = long_tag.find("-")
        # major = 1, minor = 0 (using :2 to only take index 0 and 1,
        # prevents too many values to unpack when accidental tagging RELEASE-v1.2.3)
        major, minor = long_tag[:major_index].split(".")[:2]
        minor_index = long_tag.find("-", major_index + 1)
        # patch = 22
        patch = long_tag[major_index + 1 : minor_index]
        return "v{}.{}.{}".format(major, minor, patch)
    else:
        return "not supported"


def get_dirty(repo_path):
    _, rc = exec_cmd("{} -C {} diff --quiet".format(git_exec, repo_path))
    if rc != 0:
        return "+dirty"
    return ""


parser = argparse.ArgumentParser(
    prog="version.py",
    description=(
        "Print the current release version, derived from the nearest "
        '"RELEASE-v*" git tag reachable from HEAD. Only supported when '
        "the target repo's current branch is master."
    ),
    epilog=(
        "examples:\n"
        "  python3 tools/version.py\n"
        "  python3 tools/version.py --path ../other-repo\n"
    ),
    formatter_class=argparse.RawDescriptionHelpFormatter,
)
parser.add_argument(
    "--path",
    default=".",
    help="path to the git repo to inspect (default: current directory)",
)
parsed = parser.parse_args()
version = get_version(parsed.path)
print(version)
