#include <stdio.h>

typedef struct report_job {
    int id;
    const char *name;
} report_job;

static int score_job(const report_job *job) {
    return job == NULL ? 0 : job->id * 10;
}

int main(void) {
    report_job job = {7, "demo"};
    return score_job(&job) > 0 ? 0 : 1;
}
